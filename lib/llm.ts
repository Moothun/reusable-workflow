// lib/llm.ts
// Minimal OpenRouter wrapper in JSON mode (response_format: json_object).
// We deliberately do NOT send a strict json_schema — OpenAI/Azure reject schemas
// with optional/default fields or arbitrary (z.record) objects. Instead the caller
// describes the shape in the prompt and validates the parsed result with Zod.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Guardrails — bound latency, cost, and payload size at the single LLM choke point.
const DEFAULT_TIMEOUT_MS = 60_000; // abort a hung call
const DEFAULT_MAX_TOKENS = 4000; // cap output cost / runaway generation
const MAX_ATTEMPTS = 2; // one retry, transient failures only (5xx/429/network)
const MAX_HISTORY_TURNS = 24; // trim old context so prompts don't grow unbounded
const MAX_INPUT_CHARS = 24_000; // reject oversized prompts before spending tokens

/** Transport/parse problems talking to OpenRouter. */
export class LLMError extends Error {}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** One JSON-mode call to `model`. Returns the parsed JSON, or throws LLMError. */
export async function callModel(opts: {
  model: string;
  system: string;
  user: string;
  history?: ChatTurn[];
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<unknown> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new LLMError("OPENROUTER_API_KEY is not set");

  // Trim history and reject prompts too large to be worth sending.
  const history = (opts.history ?? []).slice(-MAX_HISTORY_TURNS);
  const inputChars =
    opts.system.length +
    opts.user.length +
    history.reduce((n, h) => n + h.content.length, 0);
  if (inputChars > MAX_INPUT_CHARS)
    throw new LLMError(`Prompt too large: ${inputChars} chars (cap ${MAX_INPUT_CHARS})`);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload = JSON.stringify({
    model: opts.model,
    temperature: 0.2, // steadier structured output
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      ...history,
      { role: "user", content: opts.user },
    ],
  });

  let lastErr: LLMError = new LLMError("OpenRouter call failed");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        const err = new LLMError(`OpenRouter ${res.status}: ${detail}`);
        if (res.status >= 500 || res.status === 429) {
          lastErr = err; // transient → retry
          continue;
        }
        throw err; // 4xx → deterministic, don't retry
      }

      const data = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown } }[];
      } | null;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string")
        throw new LLMError("OpenRouter returned no message content");

      return parseJson(content);
    } catch (e) {
      // Parse errors, 4xx, and no-content are deterministic — surface immediately.
      if (e instanceof LLMError && !/^OpenRouter (5\d\d|429)/.test(e.message)) throw e;
      lastErr = controller.signal.aborted
        ? new LLMError(`OpenRouter request timed out after ${timeoutMs}ms`)
        : e instanceof LLMError
          ? e
          : new LLMError(
              `OpenRouter request failed: ${e instanceof Error ? e.message : String(e)}`,
            );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Tolerant parse — models (esp. Claude, which ignores response_format) sometimes
 * wrap JSON in prose or a ```json fence. Try raw, then a fenced block, then the
 * first brace-balanced {...} object (robust to prose containing stray braces).
 */
function parseJson(raw: string): unknown {
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const balanced = extractBalanced(raw);
  if (balanced) candidates.push(balanced);

  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  throw new LLMError("OpenRouter returned unparseable JSON");
}

/** First complete brace-balanced object, ignoring braces inside strings. */
function extractBalanced(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

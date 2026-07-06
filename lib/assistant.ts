import { z } from "zod";
import { callModel, type ChatTurn } from "@/lib/llm";
import { GraphSchema, type Graph } from "@/lib/graph";
import { registry } from "@/lib/nodes/registry";

// Sonnet 5 for both the conversation/plan and the graph build.
const PLAN_MODEL = "anthropic/claude-sonnet-5";
const BUILD_MODEL = "anthropic/claude-sonnet-5";

// A plan is a non-technical sketch: friendly steps + a plain-language explanation.
// No config — that's filled in only when the user approves and we generate the graph.
const PlanStepSchema = z.object({
  id: z.string(),
  nodeType: z.string(), // exact registry key, for later generation
  title: z.string(), // short friendly name, no jargon
  purpose: z.string(), // one plain sentence
  next: z
    .array(z.object({ to: z.string(), label: z.string().optional() }))
    .default([]),
});
export const PlanSchema = z.object({
  explanation: z.string(),
  steps: z.array(PlanStepSchema).min(1).max(40), // bound runaway plans
});
export type WorkflowPlan = z.infer<typeof PlanSchema>;

// One conversational turn's result: either a clarifying question (loop back) or
// a finished plan ready to review. The model picks which, per turn.
const ChoiceSchema = z.object({ key: z.string(), label: z.string() });
const AskSchema = z.object({
  action: z.literal("ask"),
  message: z.string(),
  choices: z.array(ChoiceSchema).default([]),
});
const PlanActionSchema = z.object({
  action: z.literal("plan"),
  explanation: z.string(),
  steps: z.array(PlanStepSchema),
});
export const ConverseSchema = z.discriminatedUnion("action", [
  AskSchema,
  PlanActionSchema,
]);
export type ConverseResult = z.infer<typeof ConverseSchema>;

const HistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(8000),
    }),
  )
  .max(50)
  .optional();

// Conversational turn: gather requirements / refine the plan (both surfaces).
export const ChatBodySchema = z.object({
  mode: z.literal("chat"),
  message: z.string().min(1).max(4000),
  history: HistorySchema,
  currentGraph: GraphSchema.optional().default({ nodes: [], edges: [] }),
});

// Approved plan → build (or edit) the real node graph.
export const GenerateBodySchema = z.object({
  mode: z.literal("generate"),
  plan: PlanSchema,
  history: HistorySchema,
  currentGraph: GraphSchema.optional().default({ nodes: [], edges: [] }),
});

const LlmGraphSchema = z.object({
  summary: z.string(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        config: z.record(z.string(), z.any()).default({}),
        onError: z.enum(["stop", "continue", "route"]).default("stop"),
        position: z.object({ x: z.number(), y: z.number() }),
      }),
    )
    .max(60), // bound graph size
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .max(120),
});

function buildCatalog() {
  return Object.entries(registry).map(([type, def]) => ({
    type,
    label: def.meta.label,
    description: def.meta.description,
    fields: def.meta.fields.map((f) => ({
      name: f.name,
      label: f.label,
      kind: f.kind,
      required: f.required ?? false,
      options: f.options,
      placeholder: f.placeholder,
      help: f.help,
    })),
  }));
}

function validateConfig(type: string, config: Record<string, unknown>) {
  const def = registry[type];
  if (!def) return {};
  const parsed = def.schema.safeParse(config);
  if (parsed.success) return parsed.data as Record<string, unknown>;
  // ทั้งก้อนถูกทิ้งถ้า field เดียวพัง — อย่างน้อย log ว่า field ไหน (กัน blank config เงียบ ๆ)
  console.warn(
    `[assistant] dropped config for "${type}":`,
    parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "),
  );
  return {};
}

function normalizeGraph(raw: z.infer<typeof LlmGraphSchema>, current: Graph): Graph {
  const positionById = new Map(current.nodes.map((n) => [n.id, n.position]));
  const validTypes = new Set(Object.keys(registry));

  const nodes = raw.nodes
    .filter((n) => validTypes.has(n.type))
    .map((n, i) => ({
      id: n.id,
      type: n.type,
      config: validateConfig(n.type, n.config ?? {}),
      onError: n.onError,
      next: [] as string[],
      position: positionById.get(n.id) ?? n.position ?? { x: 140, y: 70 * i + 60 },
    }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = raw.edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      label: e.label,
    }));

  for (const n of nodes) {
    n.next = edges.filter((e) => e.from === n.id).map((e) => e.to);
  }

  return { nodes, edges };
}

/** AI helper — สร้าง/แก้ graph จากข้อความผู้ใช้ */
export async function buildGraphFromPrompt(
  message: string,
  currentGraph: Graph,
): Promise<{ graph: Graph; summary: string }> {
  const catalog = buildCatalog();
  const isEmpty = currentGraph.nodes.length === 0;

  const system = `You are a workflow builder assistant. Output a valid workflow graph as JSON.
Available node types (use exact "type" keys):
${JSON.stringify(catalog, null, 2)}

Return a JSON object shaped exactly like:
{"summary": string, "nodes": [{"id": string, "type": string, "config": object, "onError": "stop"|"continue"|"route", "position": {"x": number, "y": number}}], "edges": [{"from": string, "to": string, "label"?: string}]}

Rules:
- ${isEmpty ? "Create a new workflow from scratch." : "Edit the existing workflow — keep node ids and positions for nodes you do not change."}
- Always include exactly one "trigger" node as the entry point.
- Use edges array for connections; labels "true"/"false" for if branches, "error" for error routing.
- Node ids: use short ids like n1, n2, n3.
- Position nodes left-to-right with ~280px horizontal spacing starting at (120, 200); put branch outputs on separate rows (~140px apart).
- Fill config fields with sensible placeholder values using {{field}} templates where helpful.
- onError defaults to "stop" unless error routing is needed.

Respond with ONLY the raw JSON object — no prose, no explanations, no markdown code fences.`;

  const raw = await callModel({
    model: BUILD_MODEL,
    system,
    user: `Current graph:\n${JSON.stringify(currentGraph, null, 2)}\n\nUser request:\n${message}`,
    maxTokens: 8000, // graphs + config are larger than a plan
  });

  const object = LlmGraphSchema.parse(raw);
  const graph = normalizeGraph(object, currentGraph);
  const validated = GraphSchema.parse(graph);
  return { graph: validated, summary: object.summary };
}

/**
 * One conversational turn for a NON-TECHNICAL user. The model either asks a
 * clarifying question (and we loop back) or returns a finished plan. It keeps
 * asking until the workflow has its essential components AND enough detail to
 * fill each node's config.
 */
export async function converse(opts: {
  message: string;
  history?: ChatTurn[];
  currentGraph: Graph;
}): Promise<ConverseResult> {
  const catalog = buildCatalog();
  const isEmpty = opts.currentGraph.nodes.length === 0;

  const system = `You are a friendly workflow assistant for NON-TECHNICAL users. You gather requirements through short questions, then produce a plan.

Available node types with their config fields (use the exact "type" key as nodeType):
${JSON.stringify(catalog, null, 2)}

Each turn, return ONE JSON object — EITHER an "ask" or a "plan".

Ask a question while you still need information — shaped exactly like:
{"action":"ask","message": string,"choices":[{"key": string,"label": string}]}
- Ask when essential workflow pieces are missing (a trigger to start it, the core actions, any decision/branch) OR when you lack information required to fill a node's config fields (e.g. which email address, which API URL, what schedule, what condition or threshold).
- Ask at most TWO questions' worth at a time. Offer 2-4 short clickable choices when the answer is a small set; use an empty choices array for free-text answers.
- Keep it plain and jargon-free.

Return a plan ONLY once you have the essentials AND enough detail to fill each node's config — shaped exactly like:
{"action":"plan","explanation": string,"steps":[{"id": string,"nodeType": string,"title": string,"purpose": string,"next":[{"to": string,"label"?: string}]}]}
- Start with exactly one "trigger" step. Use the fewest steps that achieve the goal.
- Each step: short id (n1…), exact nodeType, a friendly title (2-4 words), and a one-sentence plain purpose that captures the concrete details gathered (e.g. "Emails the summary to boss@acme.com"). Decisions use labels "yes"/"no"; error handling uses "error".
- explanation: 2-3 warm, jargon-free sentences.
- ${isEmpty ? "Plan a new workflow." : "The user has an existing workflow (below) — plan the requested EDIT, reusing existing node ids for steps you keep."}

Don't ask what you can reasonably infer, and don't over-ask: once the essentials are covered and configs are fillable, produce the plan.

Respond with ONLY the raw JSON object — no prose, no explanations, no markdown code fences.`;

  const user = `Current graph:\n${JSON.stringify(opts.currentGraph, null, 2)}\n\nUser's latest message:\n${opts.message}`;
  const raw = await callModel({
    model: PLAN_MODEL,
    system,
    user,
    history: opts.history,
  });
  return ConverseSchema.parse(raw);
}

/** Approved plan → graph. Reuses buildGraphFromPrompt so config-fill + validation stay in one place. */
export function generateFromPlan(
  plan: WorkflowPlan,
  currentGraph: Graph,
  history?: ChatTurn[],
) {
  const convo = history?.length
    ? `\n\nConversation (use it for concrete config details — emails, URLs, times, conditions):\n${history
        .map((h) => `${h.role}: ${h.content}`)
        .join("\n")}`
    : "";
  const message = `Build exactly this approved plan. Keep the same steps, ids, nodeTypes, and connections; do not add or remove steps. Fill each node's config from the concrete details in the conversation.\n\nApproved plan:\n${JSON.stringify(plan, null, 2)}${convo}`;
  return buildGraphFromPrompt(message, currentGraph);
}

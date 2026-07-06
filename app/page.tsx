"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  PenLine,
  Sparkles,
  Download,
  Send,
  GitBranch,
  Workflow,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import PlanReview from "@/components/PlanReview";
import { useAssistant } from "@/components/useAssistant";

type Workflow = { id: string; name: string; createdAt: string };

const SUGGESTIONS = [
  "Email approval flow",
  "Send a report summary to Slack",
  "Auto-screen resumes and rank candidates",
  "Webhook → notify the team",
];

const CATEGORIES: { Icon: LucideIcon; label: string; prompt: string }[] = [
  { Icon: Zap, label: "Start", prompt: "Create a workflow that runs every morning at 9am" },
  { Icon: PenLine, label: "Create", prompt: "Generate a summary document from incoming data" },
  { Icon: Sparkles, label: "AI", prompt: "Have AI summarize and categorize each incoming item" },
  { Icon: Download, label: "Get", prompt: "Pull data from an API and use it downstream" },
  { Icon: Send, label: "Send", prompt: "Send the results to Slack and email the team" },
  { Icon: GitBranch, label: "Decide", prompt: "If it passes review, forward it; otherwise notify me" },
];

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [recent, setRecent] = useState<Workflow[]>([]);
  const intentRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Approved plan → build → stash the graph → open the canvas to see it.
  const { messages, choices, plan, busy, send, approve, reset } = useAssistant({
    onBuilt: (graph) => {
      sessionStorage.setItem(
        "pendingGraph",
        JSON.stringify({ graph, name: intentRef.current.slice(0, 48) || "New workflow" }),
      );
      router.push("/canvas?new");
    },
  });

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (!intentRef.current) intentRef.current = trimmed;
    void send(trimmed);
    setInput("");
    textareaRef.current?.focus();
  };

  const startOver = () => {
    reset();
    intentRef.current = "";
  };

  const fillPrompt = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  const started = messages.length > 0;

  return (
    <div className="home">
      <header className="home-topbar">
        <span className="home-brand">
          <span className="home-brand-mark">◆</span>
          Fluxion
        </span>
        <button
          type="button"
          className="btn btn-secondary topbar-button"
          onClick={() => router.push("/canvas?new")}
        >
          + New workflow
        </button>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1 className="home-title">What workflow will you create today?</h1>
          <p className="home-subtitle">
            {plan
              ? "Here's the plan — approve it to open the canvas, or keep chatting to adjust."
              : started
                ? "Answer a couple of questions and I'll draft a plan you can approve."
                : "Describe what you want automated — AI will ask a few questions, then draft a plan."}
          </p>

          <form
            className="home-aibar"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              rows={2}
              placeholder={
                started
                  ? "Answer, or add more detail…"
                  : "e.g. Summarize PDFs emailed to me and save to Drive every Friday"
              }
            />
            <button
              type="submit"
              className="home-submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              title="Send"
            >
              {busy ? (
                <Loader2 size={18} strokeWidth={2} className="animate-spin" />
              ) : (
                <Sparkles size={18} strokeWidth={1.75} />
              )}
            </button>
          </form>

          {started && (
            <div
              className="stack stack-sm"
              style={{ maxWidth: 560, width: "100%", textAlign: "left" }}
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`chat-bubble ${m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <div className="chat-bubble chat-bubble-assistant">
                  {plan ? "Building your workflow…" : "Thinking…"}
                </div>
              )}

              {choices.length > 0 && !busy && (
                <div className="row-wrap">
                  {choices.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className="chip chip-ai"
                      onClick={() => submit(c.label)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}

              {plan && (
                <div className="surface stack stack-md" style={{ padding: 20 }}>
                  <PlanReview
                    plan={plan}
                    busy={busy}
                    onApprove={() => void approve()}
                    onStartOver={startOver}
                    approveLabel="Approve & open canvas"
                  />
                </div>
              )}
            </div>
          )}

          {!started && (
            <div className="row-wrap" style={{ justifyContent: "center" }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => submit(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </section>

        {!started && (
          <div className="cat-row">
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                type="button"
                className="cat-item"
                onClick={() => fillPrompt(c.prompt)}
                title={c.prompt}
              >
                <span className="cat-circle" aria-hidden>
                  <c.Icon size={22} strokeWidth={1.75} />
                </span>
                <span className="cat-label">{c.label}</span>
              </button>
            ))}
          </div>
        )}

        <section>
          <div className="home-section-head">
            <div className="title-md">Recent workflows</div>
            {recent.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary topbar-button"
                onClick={() => router.push("/canvas?new")}
              >
                + New
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="home-empty">
              No workflows yet — describe one above and let AI draft it for you.
            </div>
          ) : (
            <div className="recent-grid">
              {recent.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="recent-card"
                  onClick={() => router.push(`/canvas?id=${w.id}`)}
                >
                  <span className="recent-thumb" aria-hidden>
                    <Workflow size={24} strokeWidth={1.75} style={{ color: "var(--icon-fg)" }} />
                  </span>
                  <span className="title-md" style={{ fontSize: "var(--font-size-base)" }}>
                    {w.name}
                  </span>
                  <span className="helper">
                    {new Date(w.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

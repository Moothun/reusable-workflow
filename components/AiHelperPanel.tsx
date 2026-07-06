"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Graph } from "@/lib/graph";
import NodeIcon from "@/components/NodeIcon";
import PlanReview from "@/components/PlanReview";
import { useAssistant } from "@/components/useAssistant";

type SelectedNode = { id: string; type: string; label: string };

type Props = {
  currentGraph: Graph;
  onApplyGraph: (graph: Graph, summary: string) => void;
  nodeCount: number;
  /** Context props — optional so any caller compiles; they degrade gracefully. */
  workflowName?: string;
  selectedNode?: SelectedNode | null;
  /** When set to a new object, the panel auto-sends this text once (error → AI fix). */
  askFromError?: { text: string } | null;
};

const STARTERS = [
  "Read new orders, summarize with AI, and email the team",
  "Webhook → AI analysis → if approved/rejected → send an email",
  "Every morning: fetch data, transform it, summarize with AI",
];

const GREETING =
  "Hi! Tell me what you want to automate. I'll ask a couple of questions, then draft a plan you can approve.";

export default function AiHelperPanel({
  currentGraph,
  onApplyGraph,
  nodeCount,
  workflowName = "",
  selectedNode = null,
  askFromError = null,
}: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, choices, plan, busy, send, approve, reset } = useAssistant({
    getCurrentGraph: () => currentGraph,
    onBuilt: onApplyGraph,
    greeting: GREETING,
  });

  const submit = (text: string) => {
    void send(text);
    setInput("");
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  // Auto-send an error-fix prompt from the canvas. Guard by object identity so
  // it fires once per click (the caller passes a fresh object each time).
  const lastAskRef = useRef<{ text: string } | null>(null);
  useEffect(() => {
    if (askFromError && askFromError !== lastAskRef.current) {
      lastAskRef.current = askFromError;
      void send(askFromError.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askFromError]);
  // Quick actions adapt to whether a node is selected. Each seeds the conversation,
  // which loops to a plan before applying to the canvas.
  const quickActions: { label: string; prompt: string }[] = selectedNode
    ? [
        {
          label: `Add a step after ${selectedNode.label}`,
          prompt: `Add a sensible next step after the node "${selectedNode.label}" (id ${selectedNode.id}, type ${selectedNode.type}) and connect it.`,
        },
        {
          label: `Add retry to ${selectedNode.label}`,
          prompt: `Add a retry policy to the node "${selectedNode.label}" (id ${selectedNode.id}).`,
        },
        {
          label: "Add error handling",
          prompt: "Add error handling to this workflow so failures are routed to a notification.",
        },
      ]
    : [
        {
          label: "Add retry logic",
          prompt: "Add retry logic to the steps that call external services.",
        },
        {
          label: "Add error handling",
          prompt: "Add error handling so failures are routed and the team is notified.",
        },
        {
          label: "Optimize this workflow",
          prompt:
            "Optimize this workflow: remove redundant steps and improve the ordering. Explain the changes in the summary.",
        },
      ];

  return (
    <aside className="assistant-panel surface">
      <div className="assistant-header stack stack-sm">
        <div className="row-between">
          <div className="title-md row" style={{ gap: 6 }}>
            <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
            AI Helper
          </div>
          <span className="badge badge-soft-primary">{nodeCount} nodes</span>
        </div>
        <div className="helper">
          {selectedNode ? (
            <span className="row" style={{ gap: 6 }}>
              <NodeIcon type={selectedNode.type} size={22} />
              Editing <strong style={{ color: "var(--text)" }}>{selectedNode.label}</strong>
            </span>
          ) : (
            <>
              Building{" "}
              <strong style={{ color: "var(--text)" }}>{workflowName || "your workflow"}</strong>
            </>
          )}
        </div>
      </div>

      <div className="assistant-body">
        <div className="stack stack-sm">
          {messages.map((msg, i) => (
            <div key={i} className="assistant-list">
              <div
                className={`chat-bubble ${msg.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
              >
                {msg.text}
              </div>
              {msg.nodeCount != null && msg.nodeCount > 0 && (
                <span className="chat-meta">{msg.nodeCount} nodes · placed on canvas</span>
              )}
            </div>
          ))}
          {busy && (
            <div className="chat-bubble chat-bubble-assistant">
              {plan ? "Building your workflow…" : "Thinking…"}
            </div>
          )}
        </div>

        {/* Clickable answers to the AI's questions */}
        {choices.length > 0 && !busy && (
          <div className="row-wrap">
            {choices.map((c) => (
              <button
                key={c.key}
                type="button"
                className="chip chip-ai row"
                style={{ gap: 6 }}
                onClick={() => submit(c.label)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {plan && (
          <div className="stack stack-sm">
            <div className="eyebrow">Plan · review before building</div>
            <PlanReview
              plan={plan}
              busy={busy}
              onApprove={() => void approve()}
              onStartOver={reset}
              approveLabel="Approve & build on canvas"
            />
          </div>
        )}

        {!plan && (
          <div className="stack stack-sm">
            <div className="eyebrow">Quick actions</div>
            <div className="row-wrap">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="chip chip-ai row"
                  style={{ gap: 6 }}
                  disabled={busy}
                  onClick={() => submit(a.prompt)}
                >
                  <Sparkles size={13} strokeWidth={2} />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {nodeCount === 0 && !plan && (
          <div className="stack stack-sm">
            <div className="eyebrow">Try</div>
            <div className="row-wrap">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => submit(s)}
                >
                  {s.length > 40 ? s.slice(0, 40) + "…" : s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="assistant-footer stack stack-sm">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="Describe a change or answer the question…"
          rows={3}
          className="textarea"
        />
        <div className="assistant-note">Enter to send · Shift+Enter for a new line</div>
      </div>
    </aside>
  );
}

"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Graph } from "@/lib/graph";
import NodeIcon from "@/components/NodeIcon";

type Message = {
  role: "user" | "assistant";
  text: string;
  nodeCount?: number;
};

type SelectedNode = { id: string; type: string; label: string };

type Props = {
  currentGraph: Graph;
  onApplyGraph: (graph: Graph, summary: string) => void;
  nodeCount: number;
  /** Context props — optional so any caller compiles; they degrade gracefully. */
  workflowName?: string;
  selectedNode?: SelectedNode | null;
};

const STARTERS = [
  "Read new orders, summarize with AI, and email the team",
  "Webhook → AI analysis → if approved/rejected → send an email",
  "Every morning: fetch data, transform it, summarize with AI",
];

export default function AiHelperPanel({
  currentGraph,
  onApplyGraph,
  nodeCount,
  workflowName = "",
  selectedNode = null,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi! Tell me what you want to automate and I'll build it on the canvas — or pick a quick action below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "build", message: trimmed, currentGraph }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");

      onApplyGraph(data.graph as Graph, data.summary as string);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.summary as string,
          nodeCount: (data.graph as Graph).nodes.length,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setMessages((m) => [...m, { role: "assistant", text: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  // Quick actions adapt to whether a node is selected. All produce graph edits,
  // which the "build" assistant mode applies directly to the canvas.
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
          prompt:
            "Add error handling to this workflow so failures are routed to a notification.",
        },
      ]
    : [
        {
          label: "Add retry logic",
          prompt: "Add retry logic to the steps that call external services.",
        },
        {
          label: "Add error handling",
          prompt:
            "Add error handling so failures are routed and the team is notified.",
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
              Editing{" "}
              <strong style={{ color: "var(--text)" }}>{selectedNode.label}</strong>
            </span>
          ) : (
            <>
              Building{" "}
              <strong style={{ color: "var(--text)" }}>
                {workflowName || "your workflow"}
              </strong>
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
          {loading && (
            <div className="chat-bubble chat-bubble-assistant">Building your workflow…</div>
          )}
        </div>

        <div className="stack stack-sm">
          <div className="eyebrow">Quick actions</div>
          <div className="row-wrap">
            {quickActions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="chip chip-ai row"
                style={{ gap: 6 }}
                disabled={loading}
                onClick={() => void send(a.prompt)}
              >
                <Sparkles size={13} strokeWidth={2} />
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {nodeCount === 0 && (
          <div className="stack stack-sm">
            <div className="eyebrow">Try</div>
            <div className="row-wrap">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  disabled={loading}
                  onClick={() => void send(s)}
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
          disabled={loading}
          placeholder="Describe a change or a new workflow…"
          rows={3}
          className="textarea"
        />
        <div className="assistant-note">Enter to send · Shift+Enter for a new line</div>
      </div>
    </aside>
  );
}

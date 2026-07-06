"use client";

import { useState } from "react";
import type { Graph } from "@/lib/graph";
import type { WorkflowPlan } from "@/lib/assistant";

export type Choice = { key: string; label: string };
export type ChatMsg = { role: "user" | "assistant"; text: string; nodeCount?: number };

type ConverseResult =
  | { action: "ask"; message: string; choices: Choice[] }
  | { action: "plan"; explanation: string; steps: WorkflowPlan["steps"] };

const EMPTY: Graph = { nodes: [], edges: [] };

/**
 * Drives the plan→approve→build cycle shared by the home composer and the canvas
 * AI Helper. The AI loops with clarifying questions until it can produce a plan;
 * approve builds the graph and hands it back via onBuilt.
 */
export function useAssistant(opts: {
  onBuilt: (graph: Graph, summary: string) => void;
  getCurrentGraph?: () => Graph;
  greeting?: string;
}) {
  const initial = (): ChatMsg[] =>
    opts.greeting ? [{ role: "assistant", text: opts.greeting }] : [];

  const [messages, setMessages] = useState<ChatMsg[]>(initial);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentGraph = () => opts.getCurrentGraph?.() ?? EMPTY;
  const toTurns = (msgs: ChatMsg[]) => msgs.map((m) => ({ role: m.role, content: m.text }));
  const fail = (err: unknown) => {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    setError(msg);
    setMessages((m) => [...m, { role: "assistant", text: `⚠️ ${msg}` }]);
  };

  // A conversational turn → clarifying question (loop) or a finished plan.
  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const history = toTurns(messages);
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setChoices([]);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", message: trimmed, history, currentGraph: currentGraph() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");
      const result = data as ConverseResult;
      if (result.action === "plan") {
        setPlan({ explanation: result.explanation, steps: result.steps });
        setMessages((m) => [...m, { role: "assistant", text: result.explanation }]);
      } else {
        setPlan(null);
        setMessages((m) => [...m, { role: "assistant", text: result.message }]);
        setChoices(result.choices ?? []);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // Approve → build the real graph and hand it to the caller.
  const approve = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "generate",
          plan,
          history: toTurns(messages),
          currentGraph: currentGraph(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "build failed");
      opts.onBuilt(data.graph as Graph, data.summary as string);
      setPlan(null);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.summary as string, nodeCount: (data.graph as Graph).nodes.length },
      ]);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMessages(initial());
    setChoices([]);
    setPlan(null);
    setError(null);
  };

  return { messages, choices, plan, busy, error, send, approve, reset };
}

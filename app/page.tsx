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
import type { Graph } from "@/lib/graph";

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
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Workflow[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  // Describe intent → AI drafts a graph → stash it → open canvas to review
  const draft = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "build", message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not draft a workflow");
      sessionStorage.setItem(
        "pendingGraph",
        JSON.stringify({ graph: data.graph as Graph, name: trimmed.slice(0, 48) }),
      );
      router.push("/canvas?new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setDrafting(false);
    }
  };

  const fillPrompt = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void draft(input);
    }
  };

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
            Describe what you want automated — AI will draft a workflow for you to review.
          </p>

          <form
            className="home-aibar"
            onSubmit={(e) => {
              e.preventDefault();
              void draft(input);
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={drafting}
              rows={2}
              placeholder="e.g. Summarize PDFs emailed to me and save to Drive every Friday"
            />
            <button
              type="submit"
              className="home-submit"
              disabled={drafting || !input.trim()}
              aria-label="Draft workflow"
              title="Draft workflow"
            >
              {drafting ? (
                <Loader2 size={18} strokeWidth={2} className="animate-spin" />
              ) : (
                <Sparkles size={18} strokeWidth={1.75} />
              )}
            </button>
          </form>

          {drafting && (
            <div className="helper row" style={{ gap: 6 }}>
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              Drafting your workflow — opening the canvas…
            </div>
          )}
          {error && <span className="badge badge-error">{error}</span>}

          <div className="row-wrap" style={{ justifyContent: "center" }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                disabled={drafting}
                onClick={() => void draft(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

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

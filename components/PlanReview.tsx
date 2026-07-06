"use client";

import { Sparkles, ArrowDown, RotateCcw } from "lucide-react";
import type { WorkflowPlan } from "@/lib/assistant";
import NodeIcon from "@/components/NodeIcon";

/**
 * Non-technical plan preview: a simple top-to-bottom diagram of the steps plus
 * Approve / Start over. The plain-language explanation is shown in the chat above.
 */
export default function PlanReview({
  plan,
  busy,
  onApprove,
  onStartOver,
  approveLabel = "Approve & build",
}: {
  plan: WorkflowPlan;
  busy: boolean;
  onApprove: () => void;
  onStartOver: () => void;
  approveLabel?: string;
}) {
  return (
    <div className="stack stack-md" style={{ width: "100%" }}>
      <ol className="stack stack-sm" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {plan.steps.map((s, i) => (
          <li key={s.id} className="stack" style={{ gap: 6, alignItems: "center" }}>
            <div
              className="surface row"
              style={{ gap: 12, padding: "10px 14px", width: "100%", alignItems: "flex-start" }}
            >
              <NodeIcon type={s.nodeType} size={34} />
              <div className="stack" style={{ gap: 2 }}>
                <div style={{ fontWeight: 600 }}>{s.title}</div>
                <div className="helper" style={{ margin: 0 }}>
                  {s.purpose}
                </div>
                {s.next.some((e) => e.label) && (
                  <div className="row-wrap" style={{ gap: 4, marginTop: 2 }}>
                    {s.next
                      .filter((e) => e.label)
                      .map((e) => (
                        <span key={e.to + e.label} className="chip">
                          {e.label}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>
            {i < plan.steps.length - 1 && (
              <ArrowDown size={16} strokeWidth={2} style={{ color: "var(--icon-fg)" }} aria-hidden />
            )}
          </li>
        ))}
      </ol>

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary row"
          style={{ gap: 6 }}
          disabled={busy}
          onClick={onApprove}
        >
          <Sparkles size={15} strokeWidth={2} />
          {approveLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary row"
          style={{ gap: 6 }}
          disabled={busy}
          onClick={onStartOver}
        >
          <RotateCcw size={15} strokeWidth={2} />
          Start over
        </button>
      </div>
    </div>
  );
}

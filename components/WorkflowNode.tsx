"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, X, Minus, Loader2, type LucideIcon } from "lucide-react";
import type { CanvasNodeData } from "@/lib/canvas-graph";
import { nodeVisual } from "@/lib/node-catalog";
import NodeIcon from "@/components/NodeIcon";

const STATUS_ICON: Record<string, LucideIcon> = {
  success: Check,
  failed: X,
  skipped: Minus,
  running: Loader2,
  queued: Loader2,
};

export default function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData;
  const v = nodeVisual(d.type);
  const status = d.runStatus;
  const StatusIcon = status ? STATUS_ICON[status] : undefined;
  const spinning = status === "running" || status === "queued";

  const classes = [
    "workflow-node",
    d.aiHighlight ? "workflow-node--ai-highlight" : "",
    selected ? "workflow-node--selected" : "",
    status ? `workflow-node--${status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Left} className="workflow-node__handle" />
      <NodeIcon type={d.type} size={34} />
      <span className="workflow-node__body">
        <span className="workflow-node__label">{d.label}</span>
        <span className="workflow-node__cat">{v.category}</span>
      </span>
      {StatusIcon && (
        <span
          className={`workflow-node__status is-${status}`}
          title={
            status === "failed"
              ? "คลิกเพื่อดูปัญหาและวิธีแก้"
              : `Run: ${status}`
          }
        >
          <StatusIcon
            size={11}
            strokeWidth={3}
            className={spinning ? "animate-spin" : undefined}
          />
        </span>
      )}
      <Handle type="source" position={Position.Right} className="workflow-node__handle" />
    </div>
  );
}

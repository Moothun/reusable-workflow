"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNodeData } from "@/lib/canvas-graph";

export default function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData;
  const classes = [
    "workflow-node",
    d.aiHighlight ? "workflow-node--ai-highlight" : "",
    selected ? "workflow-node--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Top} className="workflow-node__handle" />
      <div className="workflow-node__label">{d.label}</div>
      <Handle type="source" position={Position.Bottom} className="workflow-node__handle" />
    </div>
  );
}

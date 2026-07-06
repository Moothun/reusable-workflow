"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNodeData } from "@/lib/canvas-graph";
import { nodeVisual } from "@/lib/node-catalog";
import NodeIcon from "@/components/NodeIcon";

export default function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData;
  const v = nodeVisual(d.type);
  const classes = [
    "workflow-node",
    d.aiHighlight ? "workflow-node--ai-highlight" : "",
    selected ? "workflow-node--selected" : "",
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
      <Handle type="source" position={Position.Right} className="workflow-node__handle" />
    </div>
  );
}

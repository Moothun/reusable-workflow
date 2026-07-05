import type { Edge, Node } from "@xyflow/react";
import type { Graph } from "@/lib/graph";
import type { NodeMeta } from "@/lib/nodes/types";

type OnError = "stop" | "continue" | "route";

export type CanvasNodeData = {
  type: string;
  label: string;
  config: Record<string, unknown>;
  onError: OnError;
  aiHighlight?: boolean;
};

/** React Flow node data accessor */
export const nodeData = (n: Node) => n.data as unknown as CanvasNodeData;

/** Contract graph → React Flow nodes (canvas apply/load) */
export function graphToFlowNodes(
  graph: Graph,
  metaByType: Map<string, NodeMeta>,
): Node[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    type: "workflow",
    data: {
      type: n.type,
      label: metaByType.get(n.type)?.label ?? n.type,
      config: n.config ?? {},
      onError: (n.onError as OnError) ?? "stop",
      aiHighlight: false,
    },
  }));
}

/** Contract graph → React Flow edges */
export function graphToFlowEdges(graph: Graph): Edge[] {
  return graph.edges.map((e, i) => ({
    id: `e${i}-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label,
  }));
}

/** Next node id sequence from existing canvas nodes */
export function maxSeqFromNodes(nodes: Node[]): number {
  const nums = nodes
    .map((n) => parseInt(n.id.replace(/\D/g, ""), 10))
    .filter((x) => !Number.isNaN(x));
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

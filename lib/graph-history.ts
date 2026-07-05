import type { Edge, Node } from "@xyflow/react";

export type CanvasSnapshot = {
  nodes: Node[];
  edges: Edge[];
  seq: number;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
};

const MAX_HISTORY = 10;

export function pushSnapshot(
  past: CanvasSnapshot[],
  snapshot: CanvasSnapshot,
): CanvasSnapshot[] {
  const next = [...past, snapshot];
  return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
}

export function popSnapshot(past: CanvasSnapshot[]): {
  snapshot: CanvasSnapshot | null;
  remaining: CanvasSnapshot[];
} {
  if (past.length === 0) return { snapshot: null, remaining: [] };
  return {
    snapshot: past[past.length - 1]!,
    remaining: past.slice(0, -1),
  };
}

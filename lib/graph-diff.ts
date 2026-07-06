import type { Graph } from "@/lib/graph";

function nodeContentKey(n: Graph["nodes"][number]) {
  return JSON.stringify({
    type: n.type,
    config: n.config ?? {},
    onError: n.onError ?? "stop",
  });
}

/** Node ids that were added or had type/config/onError changed (not position-only). */
export function diffChangedNodeIds(before: Graph, after: Graph): string[] {
  const beforeMap = new Map(before.nodes.map((n) => [n.id, n]));
  const changed: string[] = [];

  for (const n of after.nodes) {
    const old = beforeMap.get(n.id);
    if (!old) {
      changed.push(n.id);
    } else if (nodeContentKey(old) !== nodeContentKey(n)) {
      changed.push(n.id);
    }
  }

  return changed;
}

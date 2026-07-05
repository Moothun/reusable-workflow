"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import NodeConfigForm from "@/components/NodeConfigForm";
import AiHelperPanel from "@/components/AiHelperPanel";
import WorkflowNode from "@/components/WorkflowNode";
import type { NodeMeta } from "@/lib/nodes/types";
import type { Graph } from "@/lib/graph";
import {
  graphToFlowEdges,
  graphToFlowNodes,
  maxSeqFromNodes,
  nodeData,
  type CanvasNodeData,
} from "@/lib/canvas-graph";
import { diffChangedNodeIds } from "@/lib/graph-diff";
import {
  pushSnapshot,
  popSnapshot,
  type CanvasSnapshot,
} from "@/lib/graph-history";

type OnError = CanvasNodeData["onError"];
type NodeData = CanvasNodeData;

const data = nodeData;

const nodeTypes = { workflow: WorkflowNode };

function toGraph(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: data(n).type,
      config: data(n).config ?? {},
      onError: data(n).onError ?? "stop",
      next: edges.filter((e) => e.source === n.id).map((e) => e.target),
      position: n.position,
    })),
    edges: edges.map((e) => ({
      from: e.source,
      to: e.target,
      label: typeof e.label === "string" && e.label ? e.label : undefined,
    })),
  };
}

function CanvasInner() {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [seq, setSeq] = useState(1);

  const [metas, setMetas] = useState<NodeMeta[]>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState("my flow");
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAiHelper, setShowAiHelper] = useState(true);
  const [historyPast, setHistoryPast] = useState<CanvasSnapshot[]>([]);

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutosaveRef = useRef(true);
  const mountedRef = useRef(false);
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    fetch("/api/nodes")
      .then((r) => r.json())
      .then(setMetas)
      .catch(() => setMetas([]));
    fetch("/api/workflows")
      .then((r) => (r.ok ? r.json() : []))
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, []);

  const metaByType = useMemo(() => {
    const m = new Map<string, NodeMeta>();
    metas.forEach((meta) => m.set(meta.type, meta));
    return m;
  }, [metas]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const currentGraph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);

  const save = useCallback(
    async (
      graphNodes = nodes,
      graphEdges = edges,
      opts?: { silent?: boolean },
    ): Promise<string | null> => {
      setBusy(true);
      try {
        const res = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: workflowId,
            name,
            graph: toGraph(graphNodes, graphEdges),
          }),
        });
        if (!res.ok) {
          if (!opts?.silent) {
            alert("save ล้มเหลว: " + (await res.text()));
          }
          return null;
        }
        const { id } = await res.json();
        setWorkflowId(id);
        setWorkflows((ws) =>
          ws.some((w) => w.id === id) ? ws : [{ id, name }, ...ws],
        );
        return id;
      } finally {
        setBusy(false);
      }
    },
    [nodes, edges, workflowId, name],
  );

  const clearHighlights = useCallback(() => {
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: { ...data(n), aiHighlight: false },
      })),
    );
  }, [setNodes]);

  const applyGraph = useCallback(
    (graph: Graph, source: "ai" | "load" = "ai") => {
      if (source === "ai") {
        setHistoryPast((past) =>
          pushSnapshot(past, {
            nodes,
            edges,
            seq,
            selectedNodeId,
            selectedEdgeId,
          }),
        );
      }

      const before = source === "ai" ? toGraph(nodes, edges) : null;
      const changedIds =
        before && source === "ai" ? diffChangedNodeIds(before, graph) : [];

      const flowNodes = graphToFlowNodes(graph, metaByType).map((n) => ({
        ...n,
        data: {
          ...data(n),
          aiHighlight: changedIds.includes(n.id),
        },
      }));
      const flowEdges = graphToFlowEdges(graph);

      setNodes(flowNodes);
      setEdges(flowEdges);
      setSeq(maxSeqFromNodes(flowNodes));

      if (source === "load") {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }

      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 300 });
      });

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      if (changedIds.length > 0) {
        highlightTimerRef.current = setTimeout(() => {
          clearHighlights();
        }, 2500);
      }
    },
    [
      nodes,
      edges,
      seq,
      selectedNodeId,
      selectedEdgeId,
      metaByType,
      setNodes,
      setEdges,
      fitView,
      clearHighlights,
    ],
  );

  const handleAiApply = useCallback(
    (graph: Graph, _summary: string) => {
      applyGraph(graph, "ai");
    },
    [applyGraph],
  );

  const undo = useCallback(() => {
    const { snapshot, remaining } = popSnapshot(historyPast);
    if (!snapshot) return;

    setHistoryPast(remaining);
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setSeq(snapshot.seq);
    setSelectedNodeId(snapshot.selectedNodeId);
    setSelectedEdgeId(snapshot.selectedEdgeId);

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    clearHighlights();

    requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 300 });
    });
  }, [historyPast, setNodes, setEdges, fitView, clearHighlights]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void save(undefined, undefined, { silent: true });
    }, 1500);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, edges, name, save]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

  const addNode = (type: string) => {
    const id = "n" + seq;
    setSeq(seq + 1);
    const meta = metaByType.get(type);
    setNodes((ns) => [
      ...ns,
      {
        id,
        position: { x: 140, y: 70 * ns.length + 60 },
        type: "workflow",
        data: { type, label: meta?.label ?? type, config: {}, onError: "stop" },
      },
    ]);
  };

  const onConnect = useCallback(
    (c: Connection) => setEdges((e) => addEdge(c, e)),
    [setEdges],
  );

  const updateNodeData = (id: string, patch: Partial<NodeData>) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data as object), ...patch } } : n,
      ),
    );
  };

  const setEdgeLabel = (id: string, label: string) => {
    setEdges((es) =>
      es.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)),
    );
  };

  const deleteSelected = () => {
    if (selectedNodeId) {
      setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
      setEdges((es) =>
        es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
      );
      setSelectedNodeId(null);
    }
    if (selectedEdgeId) {
      setEdges((es) => es.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  };

  const load = async (id: string) => {
    const res = await fetch(`/api/workflows/${id}`);
    if (!res.ok) return;
    const wf = await res.json();
    skipAutosaveRef.current = true;
    applyGraph(wf.graph as Graph, "load");
    setName(wf.name);
    setWorkflowId(id);
    setHistoryPast([]);
  };

  const runNow = async () => {
    const id = await save();
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: id, payload: {} }),
      });
      if (!res.ok) {
        alert("run ล้มเหลว: " + (await res.text()));
        return;
      }
      const { runId } = await res.json();
      if (runId) router.push(`/runs/${runId}`);
    } finally {
      setBusy(false);
    }
  };

  const btn: React.CSSProperties = {
    display: "block",
    width: "100%",
    margin: "4px 0",
    padding: "6px 8px",
    fontSize: 13,
    borderRadius: 6,
    border: "1px solid #d4d4d8",
    background: "#fff",
    cursor: "pointer",
    textAlign: "left",
  };

  const topBtn: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: 13,
    borderRadius: 6,
    border: "1px solid #d4d4d8",
    background: "#fff",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid #eee",
          background: "#fff",
        }}
      >
        <button
          type="button"
          onClick={() => setShowAiHelper((v) => !v)}
          style={{
            ...topBtn,
            background: showAiHelper ? "#eff6ff" : "#fff",
            borderColor: showAiHelper ? "#2563eb" : "#d4d4d8",
            color: showAiHelper ? "#2563eb" : "#18181b",
          }}
        >
          ✨ AI Helper
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={historyPast.length === 0}
          title="Undo AI apply (⌘Z)"
          style={{
            ...topBtn,
            opacity: historyPast.length === 0 ? 0.45 : 1,
            cursor: historyPast.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          ↩ Undo
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888" }}>
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {showAiHelper && (
          <AiHelperPanel
            currentGraph={currentGraph}
            onApplyGraph={handleAiApply}
            nodeCount={nodes.length}
          />
        )}

        {/* palette + actions */}
        <div
          style={{
            width: 190,
            padding: 12,
            borderRight: "1px solid #eee",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 6 }}>
            NODES
          </div>
          {metas.map((m) => (
            <button
              key={m.type}
              onClick={() => addNode(m.type)}
              style={btn}
              title={m.description}
            >
              + {m.label}
            </button>
          ))}

          <hr style={{ margin: "12px 0", border: 0, borderTop: "1px solid #eee" }} />

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อ workflow"
            style={{ ...btn, cursor: "text" }}
          />
          <button onClick={() => void save()} disabled={busy} style={{ ...btn, background: "#f4f4f5" }}>
            💾 Save
          </button>
          <button
            onClick={() => void runNow()}
            disabled={busy}
            style={{
              ...btn,
              background: "#2563eb",
              color: "#fff",
              border: "1px solid #2563eb",
            }}
          >
            ▶ Run now
          </button>
          <button
            onClick={deleteSelected}
            disabled={!selectedNodeId && !selectedEdgeId}
            style={btn}
          >
            🗑 Delete selected
          </button>

          <hr style={{ margin: "12px 0", border: 0, borderTop: "1px solid #eee" }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 6 }}>
            LOAD
          </div>
          <select
            style={{ ...btn, cursor: "pointer" }}
            value={workflowId ?? ""}
            onChange={(e) => e.target.value && void load(e.target.value)}
          >
            <option value="">— เลือก workflow —</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {/* canvas — client-only to avoid React Flow SSR hydration mismatch */}
        <div style={{ flex: 1 }}>
          {clientReady ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => {
                setSelectedNodeId(n.id);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_, e) => {
                setSelectedEdgeId(e.id);
                setSelectedNodeId(null);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#888",
                fontSize: 13,
              }}
            >
              Loading canvas…
            </div>
          )}
        </div>

        {/* inspector */}
        {(selectedNode || selectedEdge) && (
          <div
            style={{
              width: 300,
              padding: 16,
              borderLeft: "1px solid #eee",
              overflowY: "auto",
            }}
          >
            {selectedNode && (
              <>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {metaByType.get(data(selectedNode).type)?.label ?? data(selectedNode).type}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>
                  {selectedNode.id} · {data(selectedNode).type}
                </div>

                <label style={{ display: "block", marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>On error</div>
                  <select
                    value={data(selectedNode).onError}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        onError: e.target.value as OnError,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 13,
                      border: "1px solid #d4d4d8",
                      borderRadius: 6,
                    }}
                  >
                    <option value="stop">stop — หยุด run</option>
                    <option value="continue">continue — ข้าม</option>
                    <option value="route">route — ไป edge ชื่อ error</option>
                  </select>
                </label>

                {metaByType.has(data(selectedNode).type) && (
                  <NodeConfigForm
                    meta={metaByType.get(data(selectedNode).type)!}
                    config={data(selectedNode).config ?? {}}
                    onChange={(cfg) => updateNodeData(selectedNode.id, { config: cfg })}
                  />
                )}
              </>
            )}

            {selectedEdge && (
              <>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Edge</div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>
                  {selectedEdge.source} → {selectedEdge.target}
                </div>
                <label style={{ display: "block" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Label</div>
                  <input
                    value={(selectedEdge.label as string) ?? ""}
                    onChange={(e) => setEdgeLabel(selectedEdge.id, e.target.value)}
                    placeholder="true / false / error"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 13,
                      border: "1px solid #d4d4d8",
                      borderRadius: 6,
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    ใช้กับ if (true/false) และ error routing (error)
                  </div>
                </label>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

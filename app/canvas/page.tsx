"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
import NodePalette from "@/components/NodePalette";
import WorkflowNode from "@/components/WorkflowNode";
import NodeIcon from "@/components/NodeIcon";
import {
  Play,
  Undo2,
  Plus,
  Trash2,
  Waypoints,
  LayoutGrid,
  Loader2,
  X,
  RotateCcw,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { friendlyError, statusThai } from "@/lib/friendly-errors";
import { BRAND } from "@/lib/brand";
import BrandMark from "@/components/BrandMark";
import type { NodeMeta } from "@/lib/nodes/types";
import type { Graph } from "@/lib/graph";
import {
  FLOW_EDGE,
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

const statusVariant = (s: string) =>
  s === "success" ? "success" : s === "failed" ? "error" : "neutral";
const fmtIO = (v: unknown) => (v == null ? "—" : JSON.stringify(v, null, 2));
const shortJson = (v: unknown, n = 400) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return "-";
  return s.length > n ? s.slice(0, n) + "…" : s;
};

type RunNode = {
  nodeId: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
};

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
  const { fitView, screenToFlowPosition } = useReactFlow();
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyPast, setHistoryPast] = useState<CanvasSnapshot[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [runNodeRuns, setRunNodeRuns] = useState<RunNode[]>([]);
  const [partialRun, setPartialRun] = useState(false);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [askFromError, setAskFromError] = useState<{ text: string } | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [retryingNodeId, setRetryingNodeId] = useState<string | null>(null);

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skipAutosaveRef = useRef(true);
  const mountedRef = useRef(false);
  const didInitRef = useRef(false);
  const [clientReady, setClientReady] = useState(false);
  const [metasLoaded, setMetasLoaded] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    fetch("/api/nodes")
      .then((r) => r.json())
      .then(setMetas)
      .catch(() => setMetas([]))
      .finally(() => setMetasLoaded(true));
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

  const selectedNodeInfo = selectedNode
    ? {
        id: selectedNode.id,
        type: data(selectedNode).type,
        label:
          metaByType.get(data(selectedNode).type)?.label ??
          data(selectedNode).label ??
          data(selectedNode).type,
      }
    : null;

  const nodeRunsById = useMemo(() => {
    const m: Record<string, RunNode> = {};
    for (const nr of runNodeRuns) m[nr.nodeId] = nr;
    return m;
  }, [runNodeRuns]);

  // Best-effort "currently running" node while active: the next reachable node
  // that hasn't produced a NodeRun yet (NodeRuns are written on completion).
  const runningNodeId = useMemo(() => {
    if (runStatus !== "running" && runStatus !== "queued") return null;
    const done = new Set(runNodeRuns.map((r) => r.nodeId));
    if (runNodeRuns.length === 0) {
      const start = nodes.find((n) => data(n).type === "trigger") ?? nodes[0];
      return start && !done.has(start.id) ? start.id : null;
    }
    const last = runNodeRuns[runNodeRuns.length - 1].nodeId;
    const edge = edges.find((e) => e.source === last && !done.has(e.target));
    return edge?.target ?? null;
  }, [runStatus, runNodeRuns, nodes, edges]);

  // Inject run status for display only — kept out of `nodes` so run polling
  // never triggers autosave (toGraph ignores runStatus anyway).
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...(n.data as object),
          runStatus:
            n.id === runningNodeId ? "running" : nodeRunsById[n.id]?.status,
        },
      })),
    [nodes, nodeRunsById, runningNodeId],
  );

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
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        e.key === "/" ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId || selectedEdgeId) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, selectedNodeId, selectedEdgeId]);

  const applyRunPayload = useCallback(
    (json: { runId: string | null; status?: string; nodeRuns?: RunNode[] }) => {
      if (!json.runId) {
        setActiveRunId(null);
        setRunStatus(null);
        setRunNodeRuns([]);
        return;
      }
      setActiveRunId(json.runId);
      setRunStatus(json.status ?? null);
      setRunNodeRuns(json.nodeRuns ?? []);
    },
    [],
  );

  // Poll a specific run by id (so a test/scheduled run can't be confused for it).
  const fetchRun = useCallback(
    async (runId: string) => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) return;
        applyRunPayload(await res.json());
      } catch {
        // ignore transient poll errors
      }
    },
    [applyRunPayload],
  );

  // Load a workflow's latest run (on open) to show its last node states.
  const fetchLatestRun = useCallback(
    async (wfId: string) => {
      try {
        const res = await fetch(`/api/workflows/${wfId}/latest-run`);
        if (!res.ok) return;
        applyRunPayload(await res.json());
      } catch {
        // ignore transient errors
      }
    },
    [applyRunPayload],
  );

  // Poll every 1s while active; clear on terminal / run change / unmount (no leak).
  useEffect(() => {
    if (!activeRunId) return;
    if (runStatus !== "queued" && runStatus !== "running") return;
    pollRef.current = setInterval(() => void fetchRun(activeRunId), 1000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeRunId, runStatus, fetchRun]);

  // Collapse the technical-details box when switching between nodes.
  useEffect(() => setShowTechnical(false), [selectedNodeId]);

  const addNode = (type: string) => {
    const id = "n" + seq;
    setSeq(seq + 1);
    const meta = metaByType.get(type);

    // Place below the anchor (selected node, else the most recent one) so nodes
    // never stack on the same pixel; fall back to viewport center for the first.
    const anchor =
      nodes.find((n) => n.id === selectedNodeId) ?? nodes[nodes.length - 1] ?? null;
    const position = anchor
      ? { x: anchor.position.x + 280, y: anchor.position.y }
      : typeof window !== "undefined"
        ? screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
        : { x: 160, y: 200 };

    setNodes((ns) => [
      ...ns,
      {
        id,
        position,
        type: "workflow",
        data: { type, label: meta?.label ?? type, config: {}, onError: "stop" },
      },
    ]);

    // If a node was selected, chain the new one onto it — sequential building
    // becomes a single action instead of add-then-wire.
    if (selectedNodeId) {
      setEdges((es) =>
        addEdge(
          {
            ...FLOW_EDGE,
            source: selectedNodeId,
            target: id,
            sourceHandle: null,
            targetHandle: null,
          },
          es,
        ),
      );
    }

    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const onConnect = useCallback(
    (c: Connection) => setEdges((e) => addEdge({ ...c, ...FLOW_EDGE }, e)),
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

  // Auto-arrange nodes into clean left-to-right layers by graph depth.
  // Undoable via ⌘Z (reuses the snapshot history).
  const tidyLayout = () => {
    if (nodes.length === 0) return;

    const adj = new Map(nodes.map((n) => [n.id, [] as string[]]));
    const indeg = new Map(nodes.map((n) => [n.id, 0]));
    edges.forEach((e) => {
      if (adj.has(e.source) && indeg.has(e.target)) {
        adj.get(e.source)!.push(e.target);
        indeg.set(e.target, indeg.get(e.target)! + 1);
      }
    });

    // Kahn topological pass → longest-path layer index per node.
    const layer = new Map(nodes.map((n) => [n.id, 0]));
    const work = new Map(indeg);
    const queue = nodes.filter((n) => work.get(n.id) === 0).map((n) => n.id);
    while (queue.length) {
      const id = queue.shift()!;
      for (const t of adj.get(id) ?? []) {
        layer.set(t, Math.max(layer.get(t)!, layer.get(id)! + 1));
        work.set(t, work.get(t)! - 1);
        if (work.get(t) === 0) queue.push(t);
      }
    }

    // x by layer, y by order within layer (nodes in cycles stay at layer 0).
    const COL = 280;
    const ROW = 120;
    const X0 = 120;
    const Y0 = 160;
    const rowInLayer = new Map<number, number>();
    const pos = new Map<string, { x: number; y: number }>();
    nodes.forEach((n) => {
      const L = layer.get(n.id) ?? 0;
      const row = rowInLayer.get(L) ?? 0;
      rowInLayer.set(L, row + 1);
      pos.set(n.id, { x: X0 + L * COL, y: Y0 + row * ROW });
    });

    setHistoryPast((past) =>
      pushSnapshot(past, { nodes, edges, seq, selectedNodeId, selectedEdgeId }),
    );
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
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
    setActiveRunId(null);
    setRunStatus(null);
    setRunNodeRuns([]);
    setPartialRun(false);
    setRunPanelOpen(false);
    void fetchLatestRun(id);
  };

  // Deep-link from Home: ?id=<wf> opens it; otherwise apply an AI draft stashed
  // in sessionStorage. Runs once, after node metas resolve so labels render.
  useEffect(() => {
    if (didInitRef.current || !metasLoaded) return;
    didInitRef.current = true;

    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      void load(id);
      return;
    }

    const pending = sessionStorage.getItem("pendingGraph");
    if (!pending) return;
    sessionStorage.removeItem("pendingGraph");
    try {
      const parsed = JSON.parse(pending) as { graph: Graph; name?: string };
      skipAutosaveRef.current = true;
      if (parsed.name) setName(parsed.name);
      applyGraph(parsed.graph, "load");
    } catch {
      // ignore malformed draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metasLoaded]);

  const startRun = async (
    startNodeId?: string,
    payload: Record<string, unknown> = {},
    stopNodeId?: string,
  ) => {
    const id = await save();
    if (!id) return;
    // cancel any in-flight poll before starting a fresh run
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: id, payload, startNodeId, stopNodeId }),
      });
      if (!res.ok) {
        alert("run ล้มเหลว: " + (await res.text()));
        return;
      }
      const { runId } = await res.json();
      if (runId) {
        setActiveRunId(runId);
        setRunStatus("queued");
        setRunNodeRuns([]);
        setPartialRun(!!startNodeId);
        setRunPanelOpen(true);
        void fetchRun(runId);
      }
    } finally {
      setBusy(false);
    }
  };
  const runNow = () => void startRun();

  // Partial run via the synchronous /api/test (directRunner) — reliable, runs the
  // CURRENT interpreter in-process (the Inngest path drops start/stopNodeId).
  // single=true → run ONLY that node (start == stop); else from the node onward.
  const runSync = async (nodeId: string, single: boolean) => {
    const nr = nodeRunsById[nodeId];
    const id = await save();
    if (!id) return;
    setRetryingNodeId(nodeId);
    setRunPanelOpen(true);
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: id,
          startNodeId: nodeId,
          stopNodeId: single ? nodeId : undefined,
          sampleInput: nr?.input ?? {},
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("รันไม่สำเร็จ: " + (data.error ?? ""));
        return;
      }
      // merge only the nodes that just ran; keep the rest of the run's statuses
      const updated: RunNode[] = data.nodeRuns ?? [];
      setRunNodeRuns((prev) => {
        const map = new Map(prev.map((n) => [n.nodeId, n]));
        for (const u of updated) map.set(u.nodeId, u);
        return [...map.values()];
      });
      setPartialRun(!single);
    } finally {
      setRetryingNodeId(null);
    }
  };

  // "ลองใหม่ขั้นตอนนี้" = รัน node เดียวด้วยอินพุตเดิม · "รันจากขั้นตอนนี้" = ตั้งแต่ node นี้ไป
  const retryNode = (nodeId: string) => void runSync(nodeId, true);
  const runFromHere = (nodeId: string) => void runSync(nodeId, false);

  const composeErrorPrompt = (node: Node) => {
    const nr = nodeRunsById[node.id];
    const label = metaByType.get(data(node).type)?.label ?? data(node).type;
    return (
      `ขั้นตอน "${label}" (${data(node).type}) รันแล้วเกิดข้อผิดพลาด:\n${nr?.error ?? ""}\n\n` +
      `การตั้งค่าปัจจุบัน: ${shortJson(data(node).config ?? {})}\n` +
      `ข้อมูลที่รับเข้ามา: ${shortJson(nr?.input)}\n\n` +
      `ช่วยอธิบายสาเหตุแบบเข้าใจง่ายสำหรับคนไม่เขียนโค้ด และบอกวิธีแก้ทีละขั้น ` +
      `ถ้าแก้การตั้งค่าได้ ให้เสนอค่าใหม่`
    );
  };

  const askAiToFix = (node: Node) => {
    setAskFromError({ text: composeErrorPrompt(node) });
  };

  const nodeLabel = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? data(n).label : id;
  };

  return (
    <main className="stack" style={{ height: "100vh", overflow: "hidden" }}>
      <div className="topbar">
        <a
          href="/"
          className="btn btn-secondary topbar-button topbar-back"
          aria-label="กลับหน้าหลัก"
          title="กลับหน้าหลัก"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          <span className="hidden sm:inline">หน้าหลัก</span>
        </a>
        <span className="topbar-sep" />
        <span
          className="home-brand"
          style={{ fontSize: "var(--font-size-base)" }}
        >
          <span className="home-brand-mark">
            <BrandMark size={18} />
          </span>
          <span className="hidden md:inline">{BRAND.name}</span>
        </span>
        <span className="topbar-sep" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled workflow"
          className="input topbar-name"
          aria-label="Workflow name"
        />
        <span className="helper" aria-live="polite">
          {busy ? "Saving…" : "Saved"}
        </span>

        <div className="flex-1" />

        <button
          type="button"
          onClick={tidyLayout}
          disabled={nodes.length === 0}
          title="Auto-arrange nodes left-to-right"
          className="btn btn-secondary topbar-button"
        >
          <LayoutGrid size={15} strokeWidth={2} /> Tidy
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={historyPast.length === 0}
          title="Undo (⌘Z)"
          className="btn btn-secondary topbar-button"
        >
          <Undo2 size={15} strokeWidth={2} /> Undo
        </button>
        <select
          className="select topbar-select"
          value={workflowId ?? ""}
          onChange={(e) => e.target.value && void load(e.target.value)}
          aria-label="Open workflow"
        >
          <option value="">Open…</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={runNow}
          disabled={busy || runStatus === "queued" || runStatus === "running"}
          className="btn btn-primary topbar-button"
        >
          {runStatus === "queued" ? (
            <>
              <Loader2 size={15} strokeWidth={2} className="animate-spin" /> Queued…
            </>
          ) : runStatus === "running" ? (
            <>
              <Loader2 size={15} strokeWidth={2} className="animate-spin" /> Running…
            </>
          ) : (
            <>
              <Play size={15} strokeWidth={2} /> Run
            </>
          )}
        </button>
        {activeRunId && (
          <button
            type="button"
            className="badge run-pill"
            onClick={() => setRunPanelOpen((v) => !v)}
            title="Toggle run panel"
          >
            <span className={`run-dot is-${runStatus ?? "queued"}`} />
            {runStatus === "running" || runStatus === "queued"
              ? "Running…"
              : `Run ${runStatus}`}
          </button>
        )}
        <span className="badge">
          {nodes.length} · {edges.length}
        </span>
      </div>

      <div className="canvas-shell" style={{ minHeight: 0, flex: 1 }}>
        <AiHelperPanel
          currentGraph={currentGraph}
          onApplyGraph={handleAiApply}
          nodeCount={nodes.length}
          workflowName={name}
          selectedNode={selectedNodeInfo}
          askFromError={askFromError}
        />

        <section className="canvas-stage surface hero-surface panel panel-compact">
          {clientReady ? (
            <ReactFlow
              className="canvas-flow"
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              defaultEdgeOptions={FLOW_EDGE}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
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
              <Background gap={20} />
              <MiniMap className="canvas-minimap" pannable zoomable />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="row h-full justify-center text-muted text-sm">
              Loading canvas…
            </div>
          )}

          {clientReady && nodes.length === 0 && (
            <div className="canvas-empty">
              <span className="canvas-empty-icon">
                <Waypoints size={26} strokeWidth={1.5} />
              </span>
              <div className="title-md">Start building</div>
              <div className="helper">
                Press <kbd className="fab-kbd">/</kbd> to add a node, or ask the AI
                Helper to draft a workflow for you.
              </div>
            </div>
          )}

          {clientReady && (
            <button
              type="button"
              className="canvas-add-fab"
              onClick={() => setPaletteOpen(true)}
              title="Add node ( / or ⌘K )"
            >
              <Plus size={16} strokeWidth={2} /> Add node
              <kbd className="fab-kbd">/</kbd>
            </button>
          )}
        </section>

        {(selectedNode || selectedEdge) && (
          <aside className="inspector surface panel stack-md overflow-y-auto">
            {selectedNode && (
              <div className="stack stack-md">
                <div className="row-between">
                  <div>
                    <div className="title-md row" style={{ gap: 8 }}>
                      <NodeIcon type={data(selectedNode).type} size={26} />
                      {metaByType.get(data(selectedNode).type)?.label ?? data(selectedNode).type}
                    </div>
                    <div className="helper">
                      {selectedNode.id} · {data(selectedNode).type}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="btn btn-danger topbar-button"
                    title="Delete node (⌫)"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>

                <label className="field">
                  <div className="label">On error</div>
                  <select
                    value={data(selectedNode).onError}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        onError: e.target.value as OnError,
                      })
                    }
                    className="select"
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

                {nodeRunsById[selectedNode.id]?.status !== "failed" && (
                  <button
                    type="button"
                    onClick={() => runFromHere(selectedNode.id)}
                    disabled={busy || retryingNodeId === selectedNode.id}
                    className="btn btn-secondary"
                    style={{ width: "100%", justifyContent: "center" }}
                    title="รัน workflow เริ่มจากขั้นตอนนี้"
                  >
                    {retryingNodeId === selectedNode.id ? (
                      <>
                        <Loader2 size={14} strokeWidth={2} className="animate-spin" /> กำลังรัน…
                      </>
                    ) : (
                      <>
                        <Play size={14} strokeWidth={2} /> รันจากขั้นตอนนี้
                      </>
                    )}
                  </button>
                )}

                {(() => {
                  const nr = nodeRunsById[selectedNode.id];
                  const retrying = retryingNodeId === selectedNode.id;

                  if (!nr) {
                    return (
                      <div className="stack stack-sm">
                        <div className="eyebrow">ผลรันล่าสุด</div>
                        <div className="helper">
                          ยังไม่มีข้อมูล — กด Run เพื่อดูผลของขั้นตอนนี้
                        </div>
                      </div>
                    );
                  }

                  if (nr.status === "failed") {
                    return (
                      <div className="stack stack-sm">
                        <div className="eyebrow">ผลรันล่าสุด</div>
                        <div className="error-friendly">
                          <div className="error-friendly__summary">
                            {friendlyError(nr.error ?? "")}
                          </div>
                          <div className="row-wrap" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={retrying}
                              onClick={() => retryNode(selectedNode.id)}
                            >
                              {retrying ? (
                                <>
                                  <Loader2
                                    size={14}
                                    strokeWidth={2}
                                    className="animate-spin"
                                  />{" "}
                                  กำลังลองใหม่…
                                </>
                              ) : (
                                <>
                                  <RotateCcw size={14} strokeWidth={2} /> ลองใหม่ขั้นตอนนี้
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => askAiToFix(selectedNode)}
                            >
                              <Sparkles size={14} strokeWidth={2} /> ให้ AI ช่วยแก้
                            </button>
                          </div>
                          <button
                            type="button"
                            className="link error-friendly__toggle"
                            onClick={() => setShowTechnical((v) => !v)}
                          >
                            ดูรายละเอียดทางเทคนิค {showTechnical ? "▴" : "▾"}
                          </button>
                          {showTechnical && (
                            <div className="stack stack-sm">
                              <pre className="code-block code-block-error">
                                {nr.error}
                              </pre>
                              <div className="label">ข้อมูลที่รับเข้ามา</div>
                              <pre className="code-block">{fmtIO(nr.input)}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="stack stack-sm">
                      <div className="row-between">
                        <div className="eyebrow">ผลรันล่าสุด</div>
                        <span
                          className={`badge badge-${statusVariant(nr.status)}`}
                        >
                          {statusThai(nr.status)}
                        </span>
                      </div>
                      <div className="label">ข้อมูลเข้า</div>
                      <pre className="code-block">{fmtIO(nr.input)}</pre>
                      <div className="label">ผลลัพธ์</div>
                      <pre className="code-block">{fmtIO(nr.output)}</pre>
                    </div>
                  );
                })()}
              </div>
            )}

            {selectedEdge && (
              <div className="stack stack-md">
                <div className="row-between">
                  <div>
                    <div className="title-md">Connection</div>
                    <div className="helper">
                      {selectedEdge.source} → {selectedEdge.target}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="btn btn-danger topbar-button"
                    title="Delete connection (⌫)"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>
                <label className="field">
                  <div className="label">Label</div>
                  <input
                    value={(selectedEdge.label as string) ?? ""}
                    onChange={(e) => setEdgeLabel(selectedEdge.id, e.target.value)}
                    placeholder="true / false / error"
                    className="input"
                  />
                  <div className="helper">
                    ใช้กับ if (true/false) และ error routing (error)
                  </div>
                </label>
              </div>
            )}
          </aside>
        )}
      </div>

      {runPanelOpen && (
        <div className="run-panel surface">
          <div className="run-panel__head">
            <div className="row" style={{ gap: 8 }}>
              <span className={`run-dot is-${runStatus ?? "queued"}`} />
              <strong style={{ fontSize: "var(--font-size-sm)" }}>Run</strong>
              <span className="helper">
                {runNodeRuns.length}/{nodes.length} nodes
              </span>
              {partialRun && <span className="badge badge-warning">partial</span>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {activeRunId && (
                <button
                  type="button"
                  className="link"
                  onClick={() => router.push(`/runs/${activeRunId}`)}
                >
                  Open full run →
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary topbar-button"
                onClick={() => setRunPanelOpen(false)}
                title="Close run panel"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
          </div>

          {partialRun && (
            <div className="run-panel__warn">
              รันบางส่วน: node ก่อนหน้าไม่ถูกรัน — ค่าจาก {"{{node.field}}"} ก่อนจุดนี้จะว่าง
            </div>
          )}

          <div className="run-panel__timeline">
            {runNodeRuns.length === 0 &&
              runStatus !== "running" &&
              runStatus !== "queued" && (
                <div className="helper">No steps yet.</div>
              )}
            {runNodeRuns.map((nr) => (
              <button
                key={nr.nodeId}
                type="button"
                className={`run-row is-${nr.status}`}
                onClick={() => {
                  setSelectedNodeId(nr.nodeId);
                  setSelectedEdgeId(null);
                }}
              >
                <span className={`run-dot is-${nr.status}`} />
                <span className="run-row__id">{nodeLabel(nr.nodeId)}</span>
                <span className="helper">{nr.status}</span>
              </button>
            ))}
            {runningNodeId && (
              <div className="run-row is-running">
                <span className="run-dot is-running" />
                <span className="run-row__id">{nodeLabel(runningNodeId)}</span>
                <span className="helper">running…</span>
              </div>
            )}
          </div>
        </div>
      )}

      <NodePalette
        metas={metas}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={addNode}
      />
    </main>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

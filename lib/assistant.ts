import { generateObject } from "ai";
import { z } from "zod";
import { DEFAULT_MODEL, openrouter } from "@/lib/ai";
import { GraphSchema, type Graph } from "@/lib/graph";
import { registry } from "@/lib/nodes/registry";

export const BuildBodySchema = z.object({
  mode: z.literal("build"),
  message: z.string().min(1),
  currentGraph: GraphSchema.optional().default({ nodes: [], edges: [] }),
});

const LlmGraphSchema = z.object({
  summary: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      config: z.record(z.string(), z.any()).default({}),
      onError: z.enum(["stop", "continue", "route"]).default("stop"),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      label: z.string().optional(),
    }),
  ),
});

function buildCatalog() {
  return Object.entries(registry).map(([type, def]) => ({
    type,
    label: def.meta.label,
    description: def.meta.description,
    fields: def.meta.fields.map((f) => ({
      name: f.name,
      label: f.label,
      kind: f.kind,
      required: f.required ?? false,
      options: f.options,
      placeholder: f.placeholder,
      help: f.help,
    })),
  }));
}

function validateConfig(type: string, config: Record<string, unknown>) {
  const def = registry[type];
  if (!def) return {};
  const parsed = def.schema.safeParse(config);
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

function normalizeGraph(raw: z.infer<typeof LlmGraphSchema>, current: Graph): Graph {
  const positionById = new Map(current.nodes.map((n) => [n.id, n.position]));
  const validTypes = new Set(Object.keys(registry));

  const nodes = raw.nodes
    .filter((n) => validTypes.has(n.type))
    .map((n, i) => ({
      id: n.id,
      type: n.type,
      config: validateConfig(n.type, n.config ?? {}),
      onError: n.onError,
      next: [] as string[],
      position: positionById.get(n.id) ?? n.position ?? { x: 140, y: 70 * i + 60 },
    }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = raw.edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      label: e.label,
    }));

  for (const n of nodes) {
    n.next = edges.filter((e) => e.from === n.id).map((e) => e.to);
  }

  return { nodes, edges };
}

/** AI helper — สร้าง/แก้ graph จากข้อความผู้ใช้ */
export async function buildGraphFromPrompt(
  message: string,
  currentGraph: Graph,
): Promise<{ graph: Graph; summary: string }> {
  const catalog = buildCatalog();
  const isEmpty = currentGraph.nodes.length === 0;

  const system = `You are a workflow builder assistant. Output a valid workflow graph as JSON.
Available node types (use exact "type" keys):
${JSON.stringify(catalog, null, 2)}

Rules:
- ${isEmpty ? "Create a new workflow from scratch." : "Edit the existing workflow — keep node ids and positions for nodes you do not change."}
- Always include exactly one "trigger" node as the entry point.
- Use edges array for connections; labels "true"/"false" for if branches, "error" for error routing.
- Node ids: use short ids like n1, n2, n3.
- Position nodes left-to-right with ~280px horizontal spacing starting at (120, 200); put branch outputs on separate rows (~140px apart).
- Fill config fields with sensible placeholder values using {{field}} templates where helpful.
- onError defaults to "stop" unless error routing is needed.`;

  const { object } = await generateObject({
    model: openrouter.chat(DEFAULT_MODEL),
    schema: LlmGraphSchema,
    system,
    prompt: `Current graph:\n${JSON.stringify(currentGraph, null, 2)}\n\nUser request:\n${message}`,
  });

  const graph = normalizeGraph(object, currentGraph);
  const validated = GraphSchema.parse(graph);
  return { graph: validated, summary: object.summary };
}

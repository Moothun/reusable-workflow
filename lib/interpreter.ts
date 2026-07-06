import { prisma } from "@/lib/db";
import { registry } from "@/lib/nodes/registry";
import { resolveConfig } from "@/lib/template";
import { ok, fail, type Envelope, type Graph, type Node } from "@/lib/graph";

/** structural type ของ Inngest step (ใช้แค่ .run) */
type StepLike = { run: (id: string, fn: () => Promise<any>) => Promise<any> };

/** เพดานจำนวนก้าว กันรันหนี (D6) */
const MAX_STEPS = 100;

/**
 * เดิน graph แบบเส้นตรง (D1): active node เดียว เดินทีละก้าว
 * - guard: visited set (เจอ node ซ้ำ = cycle) + max-steps cap (D6)
 * - per-node retry loop เอง (D3) — แต่ละ attempt = step id ไม่ซ้ำ
 * - log NodeRun เป็น step แยก เขียนเสมอ (D3)
 * - error policy: stop / continue / route (D3)
 * คืน status รวมของ run (D4): failed เฉพาะตอนถูก halt, นอกนั้น success
 */
export async function runGraph(
  graph: Graph,
  runId: string,
  step: StepLike,
  payload: Record<string, unknown> = {},
  opts: { startNodeId?: string; stopNodeId?: string } = {},
): Promise<{ status: "success" | "failed" }> {
  const byId = new Map<string, Node>(graph.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  /** ผลของทุก node ที่รันแล้ว (B-lite) — ให้ {{nodeId.field}} อ้างได้ */
  const outputs: Record<string, unknown> = {};

  // partial re-run (D5): เริ่มจาก startNodeId ถ้าส่งมา (node ก่อนหน้าไม่รัน →
  // {{ก่อนหน้า.field}} จะว่างเพราะ outputs map ว่างช่วงต้น) · ไม่งั้นเริ่มที่ trigger
  // (trigger หรือ *.trigger เช่น email.trigger / file.trigger)
  let current: Node | undefined = opts.startNodeId
    ? byId.get(opts.startNodeId)
    : (graph.nodes.find((n) => n.type === "trigger" || n.type.endsWith(".trigger")) ??
      graph.nodes[0]);
  let envelope: Envelope = ok(payload);
  let steps = 0;
  let halted = false;

  while (current) {
    // GUARD 1: เพดานก้าว
    if (steps >= MAX_STEPS) {
      await logNode(step, runId, current.id, fail("max steps exceeded"), envelope);
      halted = true;
      break;
    }
    // GUARD 2: cycle (เจอ node ที่รันแล้ว)
    if (visited.has(current.id)) {
      await logNode(step, runId, current.id, fail(`cycle detected at ${current.id}`), envelope);
      halted = true;
      break;
    }

    const node: Node = current;
    const def = registry[node.type];
    if (!def) {
      await logNode(step, runId, node.id, fail(`unknown node type: ${node.type}`), envelope);
      halted = true;
      break;
    }

    const inputEnvelope = envelope;
    const maxRetries = def.retries ?? 0;

    // inline templating (B-lite): แทน {{path}} ใน config ก่อนรัน
    // {{nodeId.field}} = จาก outputs map · {{field}} = ผล node ก่อนหน้า (inputEnvelope.data)
    // อ่านข้อมูลอย่างเดียว/deterministic → resolve นอก step.run ได้ (ไม่ต้อง durable)
    const { config: resolvedConfig, missing } = resolveConfig(node.config, {
      steps: outputs,
      data: inputEnvelope.data,
    });
    if (missing.length > 0) {
      console.warn(
        `[${runId}/${node.id}] template paths not found: ${missing.join(", ")}`,
      );
    }

    // validate config ที่ resolve แล้วกับ schema ของ node (trust boundary — D7)
    const checked = def.schema.safeParse(resolvedConfig);

    let out: Envelope = fail("not run");
    if (!checked.success) {
      out = fail(
        "invalid config: " +
          checked.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; "),
      );
    } else {
      // per-node retry loop (D3) — Inngest v4 ไม่มี per-step retries
      for (let attempt = 0; ; attempt++) {
        try {
          out = (await step.run(`${node.id}#${attempt}`, () =>
            def.run(checked.data, inputEnvelope, {
              runId,
              nodeId: node.id,
              log: (m: string) => console.log(`[${runId}/${node.id}] ${m}`),
            }),
          )) as Envelope;
          break;
        } catch (e) {
          if (attempt >= maxRetries) {
            out = fail(e instanceof Error ? e.message : String(e));
            break;
          }
        }
      }
    }

    await logNode(step, runId, node.id, out, inputEnvelope);
    visited.add(node.id);
    steps++;
    outputs[node.id] = out.data; // เก็บผลให้ node หลังอ้างผ่าน {{node.id.field}}

    // single-node / range run: หยุดหลังรัน stopNodeId เสร็จ (ไม่เดินต่อ downstream)
    if (node.id === opts.stopNodeId) {
      if (out.status === "failed") halted = true;
      break;
    }

    if (out.status === "failed") {
      if (node.onError === "continue") {
        current = nextNode(byId, node);
        continue;
      }
      if (node.onError === "route") {
        current = edgeTarget(byId, graph, node, "error");
        continue;
      }
      // stop (default)
      halted = true;
      break;
    }

    // branch: ถ้า node คาย data.__branch → เดิน edge ตาม label นั้น (if / router)
    if (out.data && typeof (out.data as Record<string, unknown>).__branch === "string") {
      const { __branch, ...rest } = out.data as Record<string, unknown>;
      envelope = { ...out, data: rest }; // strip __branch ก่อนส่งต่อ
      current = edgeTarget(byId, graph, node, String(__branch));
      continue;
    }

    envelope = out;
    current = nextNode(byId, node);
  }

  return { status: halted ? "failed" : "success" };
}

/**
 * เลือก node ถัดไป — Day 2A เดินเส้นตรง: ตาม next[0]
 * (if/route แตกกิ่งตาม edge label จะมา Day 4 — แยกเป็นฟังก์ชันนี้ไว้อัปง่าย)
 */
function nextNode(byId: Map<string, Node>, node: Node): Node | undefined {
  const nextId = node.next[0];
  return nextId ? byId.get(nextId) : undefined;
}

/** เลือก node ปลายทางตาม edge label (if true/false · error route) — D4 */
function edgeTarget(
  byId: Map<string, Node>,
  graph: Graph,
  node: Node,
  label: string,
): Node | undefined {
  const edge = graph.edges.find((e) => e.from === node.id && e.label === label);
  return edge ? byId.get(edge.to) : undefined;
}

/** เขียน NodeRun เป็น step แยก (เขียนเสมอ ทั้ง success/failed) */
async function logNode(
  step: StepLike,
  runId: string,
  nodeId: string,
  out: Envelope,
  input: Envelope,
): Promise<void> {
  await step.run(`log-${nodeId}-${out.status}`, () =>
    prisma.nodeRun.create({
      data: {
        runId,
        nodeId,
        status: out.status,
        input: input.data,
        output: out.data,
        error: out.error,
      },
    }),
  );
}

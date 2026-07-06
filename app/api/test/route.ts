import { prisma } from "@/lib/db";
import { GraphSchema } from "@/lib/graph";
import { runGraph } from "@/lib/interpreter";
import { isPrismaConnectionError } from "@/lib/prisma-errors";

/**
 * POST /api/test — run ONE node (or a range) synchronously, without Inngest.
 * body: { workflowId, startNodeId, stopNodeId?, sampleInput? }
 *
 * ใช้ directRunner (step.run = เรียก fn ตรง ๆ) → รันในโปรเซสเดียว ตอบผลทันที
 * เหมาะกับ "ลองใหม่ขั้นตอนนี้" (start == stop = node เดียว) — ไม่ต้อง poll.
 */
const directRunner = { run: (_id: string, fn: () => Promise<unknown>) => fn() };

export async function POST(req: Request) {
  try {
    const {
      workflowId,
      startNodeId,
      stopNodeId,
      sampleInput = {},
    } = await req.json();

    if (!workflowId) return new Response("ต้องมี workflowId", { status: 400 });

    const wf = await prisma.workflow.findUniqueOrThrow({
      where: { id: workflowId },
    });
    const graph = GraphSchema.parse(wf.graph);

    const run = await prisma.run.create({
      data: { workflowId, status: "running", trigger: "test" },
    });

    const result = await runGraph(graph, run.id, directRunner, sampleInput ?? {}, {
      startNodeId,
      stopNodeId,
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: result.status },
    });

    // คืน node ทุกตัวที่รันในรอบนี้ (single = 1 ตัว, range = ตั้งแต่ start เป็นต้นไป)
    // ให้ UI เอาไป merge อัปเดตเฉพาะ node เหล่านั้น
    const ran = await prisma.nodeRun.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "asc" },
    });
    const byNode = new Map<string, (typeof ran)[number]>();
    for (const nr of ran) byNode.set(nr.nodeId, nr);

    return Response.json({
      runId: run.id,
      status: result.status,
      nodeRuns: [...byNode.values()].map((nr) => ({
        nodeId: nr.nodeId,
        status: nr.status,
        input: nr.input,
        output: nr.output,
        error: nr.error,
      })),
    });
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      return new Response("database unavailable", { status: 503 });
    }
    const msg = error instanceof Error ? error.message : "test failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

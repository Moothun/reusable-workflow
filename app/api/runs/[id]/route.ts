import { prisma } from "@/lib/db";
import { isPrismaConnectionError } from "@/lib/prisma-errors";

/**
 * GET /api/runs/[id]
 * A specific run by id + per-node status/IO, for live polling on the canvas.
 * Same shape as /api/workflows/[id]/latest-run but keyed by the exact runId so a
 * test/scheduled run can't be mistaken for the one we just triggered.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = await prisma.run.findUnique({
      where: { id },
      include: { nodeRuns: { orderBy: { createdAt: "asc" } } },
    });

    if (!run) return new Response("not found", { status: 404 });

    // A node can have several NodeRuns (retries); keep the latest per nodeId
    // while preserving first-seen (execution) order.
    const byNode = new Map<string, (typeof run.nodeRuns)[number]>();
    for (const nr of run.nodeRuns) byNode.set(nr.nodeId, nr);

    return Response.json({
      runId: run.id,
      status: run.status,
      trigger: run.trigger,
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
    throw error;
  }
}

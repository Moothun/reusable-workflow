import { prisma } from "@/lib/db";
import { isPrismaConnectionError } from "@/lib/prisma-errors";

/**
 * GET /api/workflows/[id]/latest-run
 * Latest run for a workflow + per-node status/IO, for live progress on the canvas.
 * Returns { runId: null } when the workflow has never run.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = await prisma.run.findFirst({
      where: { workflowId: id },
      orderBy: { startedAt: "desc" },
      include: { nodeRuns: { orderBy: { createdAt: "asc" } } },
    });

    if (!run) return Response.json({ runId: null });

    // A node can have several NodeRuns (retries); keep the latest per nodeId.
    const byNode = new Map<string, (typeof run.nodeRuns)[number]>();
    for (const nr of run.nodeRuns) byNode.set(nr.nodeId, nr);

    return Response.json({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
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

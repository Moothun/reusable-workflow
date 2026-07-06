import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { GraphSchema } from "@/lib/graph";
import { isPrismaConnectionError } from "@/lib/prisma-errors";

/**
 * POST /api/run — trigger workflow.run.
 * body: { workflowId?, graph?, payload? }
 *
 * สร้าง Run (status "queued") แบบ sync ก่อน เพื่อคืน runId ให้ UI redirect
 * ไปหน้า log ได้ทันที แล้วค่อยยิง event ให้ Inngest interpreter ทำงานต่อ.
 */
export async function POST(req: Request) {
  try {
    const {
      workflowId: wfIdInput,
      graph,
      payload = {},
      startNodeId,
      stopNodeId,
    } = await req.json();

    let workflowId: string | undefined = wfIdInput;

    if (!workflowId) {
      if (!graph) {
        return new Response("ต้องมี workflowId หรือ graph", { status: 400 });
      }
      GraphSchema.parse(graph);
      const wf = await prisma.workflow.create({ data: { name: "inline", graph } });
      workflowId = wf.id;
    }

    const run = await prisma.run.create({
      data: { workflowId, status: "queued", trigger: "manual" },
    });

    await inngest.send({
      name: "workflow.run",
      data: {
        runId: run.id,
        workflowId,
        payload,
        trigger: "manual",
        startNodeId,
        stopNodeId,
      },
    });

    return Response.json({ runId: run.id, workflowId });
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      return Response.json(
        {
          error: "database unavailable",
          message: "Cannot start runs while the database is offline.",
        },
        { status: 503 },
      );
    }
    throw error;
  }
}

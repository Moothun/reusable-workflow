import { prisma } from "@/lib/db";
import { GraphSchema } from "@/lib/graph";
import { isPrismaConnectionError } from "@/lib/prisma-errors";

export async function POST(req: Request) {
  try {
    const { id, name, graph } = await req.json();
    GraphSchema.parse(graph);

    // มี id → update (save ทับ workflow เดิม), ไม่มี → create ใหม่
    const wf = id
      ? await prisma.workflow.update({ where: { id }, data: { name, graph } })
      : await prisma.workflow.create({ data: { name, graph } });

    return Response.json({ id: wf.id });
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      return Response.json(
        {
          error: "database unavailable",
          message: "Cannot save workflows while the database is offline.",
        },
        { status: 503 },
      );
    }
    throw error;
  }
}

export async function GET() {
  try {
    const workflows = await prisma.workflow.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    });
    return Response.json(workflows);
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      return Response.json([]);
    }
    throw error;
  }
}

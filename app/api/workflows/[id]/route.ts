import { prisma } from "@/lib/db";
import { isPrismaConnectionError } from "@/lib/prisma-errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const wf = await prisma.workflow.findUnique({ where: { id } });
    if (!wf) return new Response("not found", { status: 404 });
    return Response.json(wf);
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      return new Response("database unavailable", { status: 503 });
    }
    throw error;
  }
}

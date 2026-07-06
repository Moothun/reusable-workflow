import {
  ChatBodySchema,
  GenerateBodySchema,
  converse,
  generateFromPlan,
} from "@/lib/assistant";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Conversational turn: ask clarifying questions or return a plan.
    if (body?.mode === "chat") {
      const { message, history, currentGraph } = ChatBodySchema.parse(body);
      return Response.json(await converse({ message, history, currentGraph }));
    }
    // Approved plan → build (or edit) the real node graph.
    if (body?.mode === "generate") {
      const { plan, history, currentGraph } = GenerateBodySchema.parse(body);
      return Response.json(await generateFromPlan(plan, currentGraph, history));
    }

    return Response.json({ error: "unsupported mode" }, { status: 400 });
  } catch (err) {
    console.error("[assistant]", err);
    const msg = err instanceof Error ? err.message : "assistant failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

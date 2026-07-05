import { BuildBodySchema, buildGraphFromPrompt } from "@/lib/assistant";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mode, message, currentGraph } = BuildBodySchema.parse(body);

    if (mode !== "build") {
      return Response.json({ error: "unsupported mode" }, { status: 400 });
    }

    const result = await buildGraphFromPrompt(message, currentGraph);
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "assistant failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

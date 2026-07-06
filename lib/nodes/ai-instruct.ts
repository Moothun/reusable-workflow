import { z } from "zod";
import { generateObject } from "ai";
import { openrouter, DEFAULT_MODEL } from "@/lib/ai";
import { ok, type NodeDef } from "@/lib/graph";

/** field type ที่รองรับใน v1 (flat) */
const FieldType = z.enum(["string", "number", "boolean"]);

/**
 * ยอมรับ outputSchema แบบ shorthand object แล้ว normalize → array ที่ buildSchema ต้องการ
 *   { decision: "string", score: { type: "number", description } } → [{name,type,description}]
 * (AI assistant กับ placeholder คาย object รูปนี้ — ถ้าไม่แปลง safeParse จะ fail แล้ว config ถูกทิ้งทั้งก้อน)
 * type แปลก ๆ → "string" เพื่อให้ผ่าน FieldType เสมอ
 */
function toFieldArray(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  return Object.entries(v as Record<string, any>).map(([name, spec]) => {
    const raw = typeof spec === "string" ? spec : spec?.type;
    const type = raw === "number" || raw === "boolean" ? raw : "string";
    return { name, type, description: typeof spec === "object" ? spec?.description : undefined };
  });
}

/**
 * แปลง field list → zod object
 * [{name:"decision", type:"string", description:"..."}] → z.object({ decision: z.string().describe("...") })
 */
function buildSchema(
  fields: { name: string; type: "string" | "number" | "boolean"; description?: string }[],
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    const base =
      f.type === "number" ? z.number() : f.type === "boolean" ? z.boolean() : z.string();
    shape[f.name] = f.description ? base.describe(f.description) : base;
  }
  return z.object(shape);
}

/**
 * AI node — ให้ AI ทำงานแล้วคืน JSON ตาม schema (structured-by-default, fail-loud)
 * - มี outputSchema (field list) → คืน object ตาม schema
 * - ไม่มี outputSchema → "โหมด text" คืน { text: string } (เริ่มง่ายสำหรับ non-tech)
 */
export const aiInstruct: NodeDef = {
  schema: z.object({
    prompt: z.string(),
    model: z.string().optional(),
    outputSchema: z
      .preprocess(
        toFieldArray,
        z.array(
          z.object({
            name: z.string(),
            type: FieldType,
            description: z.string().optional(),
          }),
        ),
      )
      .optional(),
  }),
  meta: {
    label: "AI Instruct",
    description: "ให้ AI ประมวลผลข้อมูลแล้วคืนผลลัพธ์ (ระบุ field ที่อยากได้ หรือเว้นว่างเพื่อรับข้อความ)",
    fields: [
      {
        name: "prompt",
        label: "Prompt",
        kind: "textarea",
        required: true,
        placeholder: "วิเคราะห์เรซูเม่นี้: {{resume}}",
        help: "ใช้ {{field}} เพื่อแทรกค่าจาก input.data",
      },
      {
        name: "outputSchema",
        label: "Output schema (JSON)",
        kind: "json",
        required: true,
        placeholder: '{ "decision": { "type": "string", "enum": ["approve", "reject"] }, "score": "number", "reason": "string" }',
        help: "shorthand { field: \"string\" } หรือ JSON Schema ย่อ",
      },
      {
        name: "model",
        label: "Model",
        kind: "text",
        placeholder: "gpt-4o-mini",
      },
    ]
  },
  retries: 2, // randomness → retry มักผ่าน
  outputFields: (cfg) =>
    cfg?.outputSchema?.length
      ? cfg.outputSchema.map((f: { name: string }) => f.name)
      : ["text"],
  run: async (cfg, input) => {
    const schema =
      cfg.outputSchema && cfg.outputSchema.length > 0
        ? buildSchema(cfg.outputSchema)
        : z.object({ text: z.string() }); // โหมด text

    const model = openrouter.chat(cfg.model ?? DEFAULT_MODEL);
    const data = input.data as Record<string, unknown>;
    const file = typeof data.file === "string" ? data.file : undefined;

    // มีไฟล์แนบ (จาก file.trigger) → ส่งให้โมเดลอ่านเอง (ต้องใช้โมเดลที่รองรับ PDF/รูป)
    // ไม่มีไฟล์ → ยัด input.data เป็น JSON ต่อท้าย prompt เหมือนเดิม
    const { object } = file
      ? await generateObject({
          model,
          schema,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: cfg.prompt },
                {
                  type: "file",
                  data: file,
                  // มาจาก config.mimeType ก่อน · ไม่มีก็แกะจาก data URL prefix · สุดท้าย fallback PDF
                  mediaType:
                    (typeof data.mimeType === "string" && data.mimeType) ||
                    file.match(/^data:([^;,]+)[;,]/)?.[1] ||
                    "application/pdf",
                },
              ],
            },
          ],
        })
      : await generateObject({
          model,
          schema,
          prompt: `${cfg.prompt}\n\nINPUT DATA:\n${JSON.stringify(input.data)}`,
        });

    return ok(object as Record<string, unknown>);
  },
};

// self-check: shorthand object → array (run: npx tsx lib/nodes/ai-instruct.ts)
if (process.argv[1]?.replace(/\\/g, "/").endsWith("lib/nodes/ai-instruct.ts")) {
  const r = toFieldArray({ decision: { type: "string" }, score: "number", note: "text" });
  console.assert(
    JSON.stringify(r) ===
      JSON.stringify([
        { name: "decision", type: "string", description: undefined },
        { name: "score", type: "number", description: undefined },
        { name: "note", type: "string", description: undefined },
      ]),
    "toFieldArray failed:",
    r,
  );
  console.log("ok", r);
}

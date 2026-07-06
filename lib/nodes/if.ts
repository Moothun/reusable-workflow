import { z } from "zod";
import { type NodeDef } from "@/lib/graph";

/** อ่านค่าตาม dot path เช่น "user.email" */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function evaluate(left: unknown, op: string, value: string): boolean {
  switch (op) {
    case "==":
      return String(left) === value;
    case "!=":
      return String(left) !== value;
    case ">":
      return Number(left) > Number(value);
    case "<":
      return Number(left) < Number(value);
    case ">=":
      return Number(left) >= Number(value);
    case "<=":
      return Number(left) <= Number(value);
    default:
      return false;
  }
}

/**
 * if — เทียบ input.data.<field> กับ value แล้วแตกทาง
 * interpreter จะอ่าน data.__branch ("true"/"false") แล้วเดิน edge ที่ label ตรงกัน
 * (ผู้ใช้/ฝั่ง B ต้องตั้ง edge ขาออกของ if เป็น label "true" และ "false")
 */
export const ifNode: NodeDef = {
  schema: z.object({
    field: z.string(),
    op: z.enum(["==", "!=", ">", "<", ">=", "<="]),
    value: z.string(),
  }),
  meta: { 
    label: "If", 
    description: "แตกทาง true/false ตามเงื่อนไขบนข้อมูล",
    fields: [
      { name: "field", label: "Field path", kind: "text", required: true, placeholder: "decision", help: "อ่านค่าจาก input เช่น decision หรือ user.email" },
      {
        name: "op",
        label: "Operator",
        kind: "select",
        options: ["==", "!=", ">", "<", ">=", "<="],
        required: true,
      },
      { name: "value", label: "Value", kind: "text", required: true, placeholder: "approve" },
    ]
   },
  retries: 0,
  outputFields: () => [], // ส่ง input ผ่าน (ไม่เพิ่ม field ใหม่)
  run: async (cfg, input, ctx) => {
    const left = getPath(input.data, cfg.field);
    const result = evaluate(left, cfg.op, cfg.value);
    ctx.log(`if: ${cfg.field}=${JSON.stringify(left)} ${cfg.op} ${cfg.value} → ${result}`);
    return {
      status: "success",
      data: { ...input.data, __branch: result ? "true" : "false" },
      error: null,
    };
  },
};
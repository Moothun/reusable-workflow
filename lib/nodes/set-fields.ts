import { z } from "zod";
import { ok, type NodeDef } from "@/lib/graph";

/** อ่านค่าตาม dot path เช่น "user.email" */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/**
 * set — จัด/แปลงข้อมูลแบบ no-code (เวอร์ชัน non-tech ของ transform)
 * แต่ละ field: ตั้งชื่อใหม่ แล้วเลือกค่าจาก
 *   - source: คัดลอกค่าจาก input.data (dot path) เช่น "firstName"
 *   - value : ค่าคงที่ที่พิมพ์เอง
 * keepOnly = true → เอาเฉพาะ field ที่ตั้ง (ทิ้ง data เดิม) · false → รวมกับ data เดิม
 */
export const setFields: NodeDef = {
  schema: z.object({
    fields: z.array(
      z.object({
        name: z.string(),
        source: z.string().optional(),
        value: z.string().optional(),
      }),
    ),
    keepOnly: z.boolean().optional(),
  }),
  meta: {
    label: "Set Fields",
    description: "จัด/แปลงข้อมูลแบบไม่ต้องเขียนโค้ด (เลือก field จากข้อมูล หรือใส่ค่าคงที่)",
    fields: []
  },
  retries: 0,
  outputFields: (cfg) =>
    Array.isArray(cfg?.fields) ? cfg.fields.map((f: { name: string }) => f.name) : [],
  run: async (cfg, input) => {
    const out: Record<string, unknown> = cfg.keepOnly ? {} : { ...input.data };
    for (const f of cfg.fields as { name: string; source?: string; value?: string }[]) {
      out[f.name] = f.source !== undefined ? getPath(input.data, f.source) : f.value;
    }
    return ok(out);
  },
};

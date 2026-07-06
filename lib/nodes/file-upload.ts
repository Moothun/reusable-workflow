import { z } from "zod";
import { ok, type NodeDef } from "@/lib/graph";

/**
 * file.trigger — จุดเริ่ม workflow จากไฟล์ที่อัปโหลด (เช่น เรซูเม่ PDF/รูป)
 * เก็บไฟล์เป็น data URL ใน config → run แล้วส่งต่อให้ node ถัดไป (AI อ่านไฟล์เอง)
 * type ลงท้าย ".trigger" → interpreter ถือเป็น entry node (ไม่ต้องมี trigger แยก)
 */
export const fileUpload: NodeDef = {
  schema: z.object({
    file: z.string(), // data URL: "data:<mime>;base64,..."
    filename: z.string().optional(),
    mimeType: z.string().optional(),
  }),
  meta: {
    label: "Upload File",
    description: "อัปโหลดไฟล์ (เรซูเม่ PDF/รูป) เป็นจุดเริ่ม แล้วส่งให้ AI อ่าน",
    fields: [
      { name: "file", label: "File", kind: "file", required: true, help: "PDF หรือรูปภาพ" },
    ],
  },
  retries: 0,
  outputFields: () => ["file", "filename", "mimeType"],
  run: async (cfg, _input, ctx) => {
    ctx.log(`file uploaded: ${cfg.filename ?? "(unnamed)"} ${cfg.mimeType ?? ""}`);
    return ok({ file: cfg.file, filename: cfg.filename, mimeType: cfg.mimeType });
  },
};

import { z } from "zod";
import { ok, type NodeDef } from "@/lib/graph";

/**
 * แปลง payload อีเมลขาเข้า (จากผู้ให้บริการต่าง ๆ) → รูปแบบเดียว
 * รองรับ Resend inbound / SendGrid Inbound Parse / Mailgun (คีย์ต่างกัน)
 * export ไว้เพื่อ self-check (ดู __main__ ท้ายไฟล์)
 */
export function normalizeEmail(d: Record<string, any>) {
  const from = d.from ?? d.sender ?? d.envelope?.from ?? "";
  const subject = d.subject ?? "";
  // ponytail: resume = เนื้ออีเมล (plain text). ไฟล์แนบ PDF ยังไม่ถอดข้อความ
  // — ส่งแค่ metadata ผ่าน attachments · เพิ่ม pdf-parse เมื่อมีเคสจริง
  const resume = d.text ?? d["body-plain"] ?? d.body ?? d.html ?? "";
  const attachments = Array.isArray(d.attachments)
    ? d.attachments.map((a: any) => ({
        filename: a.filename ?? a.name ?? "",
        contentType: a.contentType ?? a.type ?? "",
      }))
    : [];
  return { from, subject, resume, attachments };
}

/**
 * email.trigger — จุดเริ่ม workflow จากอีเมลขาเข้า (inbound-email webhook)
 * ผู้ให้บริการเมล POST อีเมลที่ parse แล้วมาที่ /api/hooks/<workflowId>
 * → payload เข้ามาเป็น input.data → node นี้ normalize เป็น
 *   { from, subject, resume, attachments } ให้ AI node อ้าง {{resume}} ได้
 */
export const emailTrigger: NodeDef = {
  schema: z.object({}), // ไม่มี config — payload มาจาก webhook
  meta: {
    label: "On Email Received",
    description: "เริ่ม workflow เมื่อมีอีเมลเข้า แล้วดึงเนื้ออีเมล (เช่น เรซูเม่) ส่งต่อ node ถัดไป",
    fields: [],
  },
  retries: 0,
  outputFields: () => ["from", "subject", "resume", "attachments"],
  run: async (_cfg, input, ctx) => {
    const out = normalizeEmail(input.data as Record<string, any>);
    ctx.log(
      `email from=${out.from} subject="${out.subject}" bodyLen=${String(out.resume).length} attachments=${out.attachments.length}`,
    );
    return ok(out);
  },
};

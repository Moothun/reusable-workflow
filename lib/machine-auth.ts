/**
 * auth พื้นฐาน (D7) — กัน endpoint เปล่า ด้วย API key เดียว (header x-api-key)
 *
 * ใช้ใน route ที่ mutate/trigger:
 *   const unauth = requireApiKey(req);
 *   if (unauth) return unauth;          // 401 ถ้า key ไม่ตรง
 *
 * - ถ้าไม่ตั้ง env API_KEY → ปิด auth (สะดวกตอน dev local)
 * - /api/inngest ป้องกันด้วย Inngest signing key อยู่แล้ว (prod) — ไม่ต้องใช้ตัวนี้
 * - /api/hooks/[id] ใช้ workflowId (cuid เดายาก) เป็น capability URL · จะบังคับ key เพิ่มก็ได้
 */
export function requireApiKey(req: Request): Response | null {
  const expected = process.env.API_KEY;
  if (!expected) return null; // dev: ไม่ตั้ง = ไม่ตรวจ
  const got = req.headers.get("x-api-key");
  if (got !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

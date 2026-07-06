/**
 * แปลง error ดิบจาก NodeRun → ประโยคภาษาคนสำหรับผู้ใช้ที่ไม่เขียนโค้ด.
 * ไม่เข้า map ไหน → ประโยคกลางที่ชวนกด "ให้ AI ช่วยแก้".
 */
export function friendlyError(error: string): string {
  const e = (error || "").toLowerCase();
  if (e.includes("template") && e.includes("not found"))
    return "มีช่องที่อ้างถึงข้อมูลจากขั้นตอนก่อนหน้าซึ่งยังไม่มีค่า";
  if (e.includes("timeout") || e.includes("timed out") || e.includes("etimedout"))
    return "ปลายทางตอบช้าเกินไป ลองใหม่อีกครั้งได้";
  if (e.includes("resend") || e.includes("email"))
    return "ส่งอีเมลไม่สำเร็จ ลองตรวจอีเมลผู้รับและการตั้งค่า";
  if (e.includes("url")) return "ลิงก์ (URL) ไม่ถูกต้อง";
  if (e.includes("invalid config") || e.includes("required"))
    return "การตั้งค่าของขั้นตอนนี้ยังไม่ครบหรือไม่ถูกต้อง";
  return 'ขั้นตอนนี้ทำงานไม่สำเร็จ กด "ให้ AI ช่วยแก้" เพื่อดูวิธีแก้';
}

/** สถานะ NodeRun → ภาษาคน */
export function statusThai(status: string): string {
  const map: Record<string, string> = {
    success: "สำเร็จ",
    failed: "ไม่สำเร็จ",
    skipped: "ข้าม",
    running: "กำลังทำงาน",
    queued: "รอคิว",
  };
  return map[status] ?? status;
}

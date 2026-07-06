import type { NodeDef } from "@/lib/graph";

/**
 * UI field descriptor — บอก canvas ว่าจะ gen ฟอร์ม config ยังไง.
 * (Zod schema ใน NodeDef เป็น source of truth สำหรับ validate;
 *  ตัวนี้คือ projection ที่ serialize ส่งให้ client ได้ปลอดภัย)
 */
export type FieldSpec = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "boolean" | "select" | "json" | "file";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
};

/** NodeDef + descriptor ฟอร์มสำหรับ canvas (ขยายจาก contract โดยไม่แตะ shape เดิม) */
export type UiNodeDef = NodeDef & { fields: FieldSpec[] };

/** ข้อมูล node ที่ส่งให้ client (palette + config form) */
export type NodeMeta = {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
};

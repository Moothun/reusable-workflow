import type { NodeDef } from "@/lib/graph";
import { trigger } from "./trigger";
import { transform } from "./transform";
import { aiInstruct } from "./ai-instruct";
import { ifNode } from "./if";
import { httpRequest } from "./http-request";
import { emailSend } from "./email-send";
import { emailTrigger } from "./email-trigger";
import { fileUpload } from "./file-upload";
import { setFields } from "./set-fields";

/**
 * สมุดรายชื่อ node — key ต้องตรงกับ node.type ใน graph
 * เพิ่ม node ใหม่ = เพิ่ม 1 entry ที่นี่ (ไม่ต้องแตะ interpreter)
 */
export const registry: Record<string, NodeDef> = {
  trigger,
  transform,
  "ai.instruct": aiInstruct,
  if: ifNode,
  "http.request": httpRequest,
  "email.send": emailSend,
  "email.trigger": emailTrigger,
  "file.trigger": fileUpload,
  set: setFields,
};

export type NodeType = keyof typeof registry;

/** metadata สำหรับ palette/AI helper (serialize ส่ง client ได้) */
export function nodeMetas() {
  return Object.entries(registry).map(([type, def]) => ({
    type,
    label: def.meta.label,
    description: def.meta.description,
    fields: def.meta.fields,
  }));
}
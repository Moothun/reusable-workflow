import {
  Zap,
  Sparkles,
  Globe,
  Mail,
  Inbox,
  FileUp,
  GitBranch,
  Shuffle,
  SlidersHorizontal,
  Box,
  type LucideIcon,
} from "lucide-react";

/**
 * Visual metadata for node types — a monochrome Lucide icon + human category.
 * Keyed by registry type (see lib/nodes/registry.ts). Shared by the node card,
 * the command palette, the inspector, and the AI copilot so icons stay cohesive.
 */
export type NodeVisual = { Icon: LucideIcon; category: string };

const VISUALS: Record<string, NodeVisual> = {
  trigger: { Icon: Zap, category: "Trigger" },
  "ai.instruct": { Icon: Sparkles, category: "AI" },
  if: { Icon: GitBranch, category: "Logic" },
  transform: { Icon: Shuffle, category: "Data" },
  set: { Icon: SlidersHorizontal, category: "Data" },
  "http.request": { Icon: Globe, category: "Web" },
  "email.send": { Icon: Mail, category: "Message" },
  "email.trigger": { Icon: Inbox, category: "Trigger" },
  "file.trigger": { Icon: FileUp, category: "Trigger" },
};

const FALLBACK: NodeVisual = { Icon: Box, category: "Node" };

export const nodeVisual = (type: string): NodeVisual => VISUALS[type] ?? FALLBACK;

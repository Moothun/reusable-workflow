"use client";

import { useRef, useState } from "react";
import type { Graph } from "@/lib/graph";

type Message = {
  role: "user" | "assistant";
  text: string;
  nodeCount?: number;
};

type Props = {
  currentGraph: Graph;
  onApplyGraph: (graph: Graph, summary: string) => void;
  nodeCount: number;
};

const SUGGESTIONS = [
  "ดึงออเดอร์ใหม่ สรุปด้วย AI แล้วอีเมลหาทีม",
  "trigger webhook → AI วิเคราะห์ → if approve/reject → ส่งอีเมล",
  "cron รายวัน → HTTP ดึงข้อมูล → transform → AI สรุป",
];

export default function AiHelperPanel({ currentGraph, onApplyGraph, nodeCount }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "สวัสดีครับ บอกได้เลยว่าอยากสร้าง workflow แบบไหน — ผมจะวาง node ให้บน canvas",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "build", message: trimmed, currentGraph }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "request failed");
      }

      onApplyGraph(data.graph as Graph, data.summary as string);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.summary as string,
          nodeCount: (data.graph as Graph).nodes.length,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
      setMessages((m) => [...m, { role: "assistant", text: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const bubbleStyle = (role: "user" | "assistant"): React.CSSProperties => ({
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    maxWidth: "92%",
    padding: "8px 12px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.45,
    background: role === "user" ? "#2563eb" : "#f4f4f5",
    color: role === "user" ? "#fff" : "#18181b",
  });

  return (
    <div
      style={{
        width: 280,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #eee",
        background: "#fff",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid #eee",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        ✨ AI Helper
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={bubbleStyle(msg.role)}>{msg.text}</div>
            {msg.nodeCount != null && msg.nodeCount > 0 && (
              <span
                style={{
                  alignSelf: "flex-start",
                  fontSize: 11,
                  color: "#2563eb",
                  background: "#eff6ff",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {msg.nodeCount} nodes · วางบน canvas แล้ว
              </span>
            )}
          </div>
        ))}
        {loading && (
          <div style={bubbleStyle("assistant")}>กำลังสร้าง workflow…</div>
        )}
      </div>

      <div style={{ padding: "0 12px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => void send(s)}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid #d4d4d8",
              background: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
          >
            {s.length > 36 ? s.slice(0, 36) + "…" : s}
          </button>
        ))}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid #eee" }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
          placeholder="อธิบาย workflow ที่ต้องการ…"
          rows={3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #d4d4d8",
            resize: "none",
            fontFamily: "inherit",
          }}
        />
        <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
          Enter ส่ง · Shift+Enter ขึ้นบรรทัด · canvas มี {nodeCount} node
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeMeta } from "@/lib/nodes/types";
import { nodeVisual } from "@/lib/node-catalog";
import NodeIcon from "@/components/NodeIcon";

type Props = {
  metas: NodeMeta[];
  open: boolean;
  onClose: () => void;
  onPick: (type: string) => void;
};

/** VS-Code-style command palette for inserting nodes. Open with "/" or ⌘K. */
export default function NodePalette({ metas, open, onClose, onPick }: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return metas;
    return metas.filter((m) => {
      const v = nodeVisual(m.type);
      return (
        m.label.toLowerCase().includes(s) ||
        m.description.toLowerCase().includes(s) ||
        v.category.toLowerCase().includes(s) ||
        m.type.toLowerCase().includes(s)
      );
    });
  }, [metas, q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const pick = (type: string) => {
    onPick(type);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = results[active];
      if (m) pick(m.type);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Add node"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search nodes…  (AI, email, logic, webhook)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {results.length === 0 ? (
            <div className="palette-empty">No nodes match “{q}”.</div>
          ) : (
            results.map((m, i) => {
              const v = nodeVisual(m.type);
              return (
                <button
                  key={m.type}
                  className={`palette-item ${i === active ? "palette-item--active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m.type)}
                >
                  <NodeIcon type={m.type} size={34} />
                  <span className="palette-text">
                    <span className="palette-title">{m.label}</span>
                    <span className="palette-desc">{m.description}</span>
                  </span>
                  <span className="badge badge-neutral">{v.category}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="palette-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> insert
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

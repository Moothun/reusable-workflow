"use client";

import type { FieldSpec, NodeMeta } from "@/lib/nodes/types";

type Config = Record<string, unknown>;

export default function NodeConfigForm({
  meta,
  config,
  onChange,
}: {
  meta: NodeMeta;
  config: Config;
  onChange: (next: Config) => void;
}) {
  const set = (name: string, value: unknown) => onChange({ ...config, [name]: value });

  if (meta.fields.length === 0) {
    return (
      <p className="helper">
        node นี้ไม่มี config (รับ payload จาก trigger โดยตรง)
      </p>
    );
  }

  return (
    <div className="stack stack-md">
      {meta.fields.map((f) => (
        <Field key={f.name} spec={f} value={config[f.name]} onChange={(v) => set(f.name, v)} />
      ))}
    </div>
  );
}

function Field({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <label className="field">
      <div className="label">
        {spec.label}
        {spec.required && <span className="text-muted"> *</span>}
      </div>

      {spec.kind === "textarea" || spec.kind === "json" ? (
        <textarea
          rows={spec.kind === "json" ? 4 : 3}
          className="textarea"
          style={{ fontFamily: spec.kind === "json" ? "var(--font-geist-mono)" : "inherit" }}
          placeholder={spec.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : spec.kind === "boolean" ? (
        <input type="checkbox" className="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      ) : spec.kind === "number" ? (
        <input
          type="number"
          className="input"
          placeholder={spec.placeholder}
          value={(value as number) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      ) : spec.kind === "file" ? (
        <div className="stack stack-sm">
          <input
            type="file"
            className="input"
            accept="application/pdf,image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const r = new FileReader();
              r.onload = () => onChange(r.result as string);
              r.readAsDataURL(file);
            }}
          />
          {typeof value === "string" && value.startsWith("data:") && (
            <div className="helper">✓ loaded (~{Math.round(value.length / 1365)} KB)</div>
          )}
        </div>
      ) : spec.kind === "select" ? (
        <select className="select" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">— เลือก —</option>
          {spec.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          className="input"
          placeholder={spec.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {spec.help && <div className="helper">{spec.help}</div>}
    </label>
  );
}

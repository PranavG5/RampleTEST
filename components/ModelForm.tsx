"use client";

import { useState } from "react";
import type { Asset } from "@/lib/extract";
import type { FormField } from "@/lib/schema";
import { PROVIDER_LABEL, type ModelDetail } from "@/lib/types";
import { fnLabel } from "./ModelPicker";

interface Props {
  model: ModelDetail | null;
  loading: boolean;
  error: string | null;
  fields: FormField[];
  values: Record<string, unknown>;
  onValue: (name: string, v: unknown) => void;
  assets: Asset[];
  quote: { usd: number | null; error: string | null; loading: boolean };
  onGenerate: () => void;
  busy: boolean;
  formErrors: string[];
}

const inputCls = "w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-accent";

function MediaSlot({ f, value, onChange, assets }: { f: FormField; value: string[]; onChange: (v: string[]) => void; assets: Asset[] }) {
  const [url, setUrl] = useState("");
  const kinds = f.mediaKinds ?? [];
  const audioOnly = kinds.length === 1 && kinds[0] === "audio";
  const matching = assets.filter((a) => (kinds as string[]).includes(a.kind));
  const multi = f.kind === "mediaList";
  const urls = value.filter((v) => !v.startsWith("asset:"));

  function toggle(ref: string) {
    if (value.includes(ref)) onChange(value.filter((v) => v !== ref));
    else if (!multi) onChange([ref]);
    else if (!f.maxItems || value.length < f.maxItems) onChange([...value, ref]);
  }

  function addUrl() {
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) return;
    onChange(multi ? [...value, u] : [u]);
    setUrl("");
  }

  return (
    <div>
      {audioOnly ? (
        <p className="mb-2 text-xs text-muted">Audio uploads are off for now. Paste a public audio URL if this model needs one.</p>
      ) : matching.length === 0 ? (
        <p className="mb-2 text-xs text-muted">Drop {kinds.filter((k) => k !== "audio").join(" or ")} files in Inputs to use them here.</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-2">
          {matching.map((a) => {
            const ref = `asset:${a.id}`;
            const idx = value.indexOf(ref);
            const on = idx >= 0;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(ref)}
                title={a.name}
                className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 transition ${on ? "border-accent" : "border-transparent opacity-60 hover:opacity-100"}`}
              >
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.previewUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <video src={a.previewUrl} className="h-full w-full object-cover" muted />
                )}
                {on && (
                  <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
                    {multi ? idx + 1 : "✓"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {urls.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {urls.map((u) => (
            <li key={u} className="flex items-center gap-2 text-xs">
              <span className="truncate font-mono text-muted" title={u}>{u}</span>
              <button className="text-bad hover:underline" onClick={() => onChange(value.filter((v) => v !== u))}>remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addUrl()}
          placeholder="…or paste a public URL"
          className={`${inputCls} text-xs`}
        />
        <button type="button" onClick={addUrl} className="rounded-lg border border-line px-2 text-xs hover:bg-panel-2">Add</button>
      </div>
    </div>
  );
}

function FieldControl({ f, value, onChange, assets }: { f: FormField; value: unknown; onChange: (v: unknown) => void; assets: Asset[] }) {
  switch (f.kind) {
    case "media":
    case "mediaList":
      return <MediaSlot f={f} value={(value as string[]) ?? []} onChange={onChange} assets={assets} />;
    case "enum":
      return (
        <select value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {!f.required && <option value="">Default</option>}
          {f.enumValues!.map((v) => (
            <option key={String(v)} value={String(v)}>{String(v)}</option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          {value === true ? "On" : "Off"}
        </label>
      );
    case "integer":
    case "number":
      return (
        <input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          min={f.min}
          max={f.max}
          step={f.step ?? "any"}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.min !== undefined && f.max !== undefined ? `${f.min} – ${f.max}` : undefined}
          className={inputCls}
        />
      );
    case "textarea":
      return <textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={f.maxLength} className={inputCls} />;
    case "stringList":
      return <textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} placeholder="One per line" className={inputCls} />;
    case "json":
      return (
        <div>
          <textarea
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={(value as string)?.split("\n").length > 4 ? 8 : 4}
            placeholder={f.example ? `Example:\n${f.example}` : "JSON (advanced). Leave empty to skip."}
            className={`${inputCls} font-mono text-xs`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            {f.example && !value && (
              <button type="button" className="text-accent hover:underline" onClick={() => onChange(f.example)}>
                Insert example
              </button>
            )}
            <span>Use &quot;@file:name.jpg&quot; to point at a file from Inputs.</span>
          </div>
        </div>
      );
    default:
      return <input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={f.maxLength} className={inputCls} />;
  }
}

export default function ModelForm(p: Props) {
  const [showNotes, setShowNotes] = useState(false);
  const [showSchema, setShowSchema] = useState(false);

  if (!p.model) {
    return (
      <section className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">
        {p.loading ? "Loading model…" : p.error ? <span className="text-bad">{p.error}</span> : "Pick a model on the left to see its settings."}
      </section>
    );
  }

  const m = p.model;
  const fields = p.fields.filter((f) => f.kind !== "prompt");
  const mediaFields = fields.filter((f) => f.kind === "media" || f.kind === "mediaList");
  const otherFields = fields.filter((f) => !(f.kind === "media" || f.kind === "mediaList"));

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">{PROVIDER_LABEL[m.provider]}</span>
          <span>{m.vendor}</span>
          <span>· {fnLabel(m.function)}</span>
          {m.priceLabel && <span>· {m.priceLabel}</span>}
        </div>
        <h2 className="mt-1 text-lg font-semibold leading-snug">{m.name}</h2>
        <p className="font-mono text-[11px] text-muted">{m.id}</p>
        {m.description && <p className="mt-1 text-sm text-muted">{m.description}</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {m.notes.length > 0 && (
            <button className="text-accent hover:underline" onClick={() => setShowNotes((s) => !s)}>
              {showNotes ? "Hide" : "Show"} provider notes ({m.notes.length})
            </button>
          )}
          <button className="text-accent hover:underline" onClick={() => setShowSchema((s) => !s)}>
            {showSchema ? "Hide" : "View"} raw schema
          </button>
          {m.docsUrl && (
            <a href={m.docsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Docs ↗</a>
          )}
        </div>
        {showNotes && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
            {m.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
        {showSchema && (
          <pre className="scroll-thin mt-2 max-h-64 overflow-auto rounded-lg bg-panel-2 p-2 text-[11px]">{JSON.stringify(m.schema, null, 2)}</pre>
        )}
      </div>

      {mediaFields.length > 0 && (
        <div className="flex flex-col gap-4">
          {mediaFields.map((f) => (
            <div key={f.name}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-sm font-medium">{f.label}</span>
                {f.required && <span className="text-[10px] font-semibold uppercase text-bad">required</span>}
                {f.maxItems && <span className="text-xs text-muted">up to {f.maxItems}</span>}
              </div>
              {f.description && <p className="mb-1.5 text-xs text-muted">{f.description}</p>}
              <FieldControl f={f} value={p.values[f.name]} onChange={(v) => p.onValue(f.name, v)} assets={p.assets} />
            </div>
          ))}
        </div>
      )}

      {otherFields.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {otherFields.map((f) => (
            <div key={f.name} className={f.kind === "textarea" || f.kind === "json" || f.kind === "stringList" ? "sm:col-span-2" : ""}>
              <label className="mb-1 flex items-baseline gap-2">
                <span className="text-sm font-medium">{f.label}</span>
                {f.required && <span className="text-[10px] font-semibold uppercase text-bad">required</span>}
              </label>
              <FieldControl f={f} value={p.values[f.name]} onChange={(v) => p.onValue(f.name, v)} assets={p.assets} />
              {f.description && <p className="mt-1 text-xs text-muted">{f.description}</p>}
            </div>
          ))}
        </div>
      )}

      {p.formErrors.length > 0 && (
        <ul className="rounded-lg bg-panel-2 p-3 text-xs text-bad">
          {p.formErrors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-sm">
          {m.provider === "pika" ? (
            p.quote.loading ? (
              <span className="text-muted">Pricing…</span>
            ) : p.quote.usd !== null ? (
              <span>
                Est. cost <strong>${p.quote.usd.toFixed(3).replace(/0$/, "")}</strong>
              </span>
            ) : p.quote.error ? (
              <span className="text-xs text-warn" title={p.quote.error}>Pika says: {p.quote.error.slice(0, 140)}</span>
            ) : null
          ) : (
            <span className="text-xs text-muted">Higgsfield doesn&apos;t publish per-request prices. Check the console.</span>
          )}
        </div>
        <button
          onClick={p.onGenerate}
          disabled={p.busy}
          className="rounded-lg bg-accent px-5 py-2 font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-60"
        >
          {p.busy ? "Starting…" : "Generate video"}
        </button>
      </div>
    </section>
  );
}

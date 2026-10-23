"use client";

import { useMemo, useState } from "react";
import { PROVIDER_LABEL, type ModelSummary, type Provider } from "@/lib/types";

export const FUNCTION_LABEL: Record<string, string> = {
  "text-to-video": "Text → video",
  "image-to-video": "Image → video",
  "reference-to-video": "References → video",
  "video-to-video": "Video edit",
  "video-extension": "Extend video",
  "motion-control": "Motion control",
  avatar: "Avatar / lip-sync",
  "omni-video": "Omni (any input)",
  "draft-to-video": "Draft → video",
  "video-upscale": "Upscale",
  "merge-videos": "Merge videos",
  "compose-video": "Compose video",
  "caption-video": "Captions",
  other: "Other",
};

export function fnLabel(f: string): string {
  return FUNCTION_LABEL[f] ?? f.replace(/-/g, " ");
}

interface Props {
  provider: Provider;
  onProvider: (p: Provider) => void;
  models: Record<Provider, ModelSummary[] | null>;
  loadError: Record<Provider, string | null>;
  selectedId: string | null;
  onSelect: (m: ModelSummary) => void;
  runCounts: Record<string, number>;
}

export default function ModelPicker({ provider, onProvider, models, loadError, selectedId, onSelect, runCounts }: Props) {
  const [query, setQuery] = useState("");
  const [fn, setFn] = useState("all");
  const list = models[provider];

  const functions = useMemo(() => {
    const set = new Map<string, number>();
    for (const m of list ?? []) set.set(m.function, (set.get(m.function) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (list ?? []).filter(
      (m) =>
        (fn === "all" || m.function === fn) &&
        (!q || `${m.name} ${m.vendor} ${m.family} ${m.id} ${m.function}`.toLowerCase().includes(q)),
    );
    const byVendor = new Map<string, ModelSummary[]>();
    for (const m of filtered) {
      const k = m.vendor;
      byVendor.set(k, [...(byVendor.get(k) ?? []), m]);
    }
    return [...byVendor.entries()];
  }, [list, query, fn]);

  const total = groups.reduce((n, [, ms]) => n + ms.length, 0);

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel">
      <div className="border-b border-line p-3">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-1" role="tablist">
          {(["pika", "higgsfield"] as Provider[]).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={provider === p}
              onClick={() => {
                onProvider(p);
                setFn("all");
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                provider === p ? "bg-panel shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {PROVIDER_LABEL[p]}
              <span className="ml-1.5 text-xs text-muted">{models[p]?.length ?? "…"}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search models, e.g. kling, veo, seedance"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-2 w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={fn}
          onChange={(e) => setFn(e.target.value)}
          className="w-full rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent"
          aria-label="Filter by type"
        >
          <option value="all">All types ({list?.length ?? 0})</option>
          {functions.map(([f, n]) => (
            <option key={f} value={f}>
              {fnLabel(f)} ({n})
            </option>
          ))}
        </select>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {loadError[provider] && <p className="p-3 text-sm text-bad">{loadError[provider]}</p>}
        {!list && !loadError[provider] && <p className="p-3 text-sm text-muted">Loading models…</p>}
        {list && total === 0 && <p className="p-3 text-sm text-muted">No models match.</p>}
        {groups.map(([vendor, ms]) => (
          <div key={vendor} className="mb-2">
            <div className="sticky top-0 z-10 bg-panel px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {vendor}
            </div>
            {ms.map((m) => {
              const active = m.id === selectedId;
              const runs = runCounts[`${m.provider}:${m.id}`] ?? 0;
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m)}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left transition ${
                    active ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-panel-2"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {runs > 0 && (
                      <span className="shrink-0 rounded-full bg-panel-2 px-1.5 text-[10px] text-muted" title="Runs so far">
                        {runs}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{fnLabel(m.function)}</span>
                    {m.priceLabel && <span>· {m.priceLabel}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

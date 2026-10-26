"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runsToCsv } from "@/lib/history";
import { PROVIDER_LABEL, type Run } from "@/lib/types";
import { fnLabel } from "./ModelPicker";
import RunVideo from "./RunVideo";

interface Props {
  runs: Run[];
  onUpdate: (id: string, patch: Partial<Run>) => void;
  onDelete: (id: string) => void;
  onReuse: (run: Run) => void;
  onRetryArchive: (id: string) => void;
}

const ACTIVE = new Set(["uploading", "submitting", "queued", "running"]);

const STATUS_TEXT: Record<Run["status"], string> = {
  uploading: "Uploading files…",
  submitting: "Sending to provider…",
  queued: "Queued at provider…",
  running: "Generating…",
  completed: "Done",
  failed: "Failed",
};

function elapsed(r: Run, now: number): string {
  const s = Math.max(0, Math.round(((r.finishedAt ?? now) - r.createdAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const hasVideo = (r: Run) => r.status === "completed" && !!(r.providerVideoUrl || r.videoPath);

// Where the finished video is kept: the team's Storage bucket, or still only at the provider.
function ArchiveBadge({ r, onRetry }: { r: Run; onRetry: () => void }) {
  if (!hasVideo(r)) return null;
  switch (r.archiveStatus) {
    case "stored":
      return <span className="text-[11px] text-ok">Saved to team library</span>;
    case "pending":
    case "uploading":
      return <span className="text-[11px] text-muted">Saving to team library…</span>;
    case "failed":
      return (
        <span className="text-[11px] text-bad" title={r.archiveError}>
          {r.archiveRetryAt ? "Save failed, retrying soon" : "Not saved to team library"}
          {!r.archiveRetryAt && (
            <button onClick={onRetry} className="ml-2 font-medium text-accent hover:underline">Retry save</button>
          )}
        </span>
      );
    default:
      return null;
  }
}

function money(r: Run): string | null {
  if (r.costUsd !== undefined) return `$${r.costUsd.toFixed(3)}`;
  if (r.quotedUsd !== undefined) return `~$${r.quotedUsd.toFixed(3)}`;
  return null;
}

function Stars({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div className="flex items-center" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(value === n ? undefined : n)}
          className={`px-0.5 text-lg leading-none ${value && n <= value ? "text-amber-400" : "text-line hover:text-amber-300"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function RunCard({
  r, now, selected, onSelect, onUpdate, onDelete, onReuse, onRetryArchive,
}: {
  r: Run; now: number; selected: boolean; onSelect: () => void;
  onUpdate: (p: Partial<Run>) => void; onDelete: () => void; onReuse: () => void; onRetryArchive: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [notes, setNotes] = useState(r.notes ?? "");
  const active = ACTIVE.has(r.status);

  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-panel ${selected ? "border-accent ring-1 ring-accent" : "border-line"}`}>
      <div className="relative aspect-video bg-black/90">
        {hasVideo(r) ? (
          <RunVideo run={r} controls playsInline className="h-full w-full object-contain" preload="metadata" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/80">
            {active && <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
            <span>{STATUS_TEXT[r.status]}</span>
            {active && <span className="text-xs text-white/50">{elapsed(r, now)}</span>}
            {r.status === "failed" && r.error && <span className="max-h-24 overflow-auto text-xs text-red-300">{r.error}</span>}
          </div>
        )}
        <label className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[11px] text-white">
          <input type="checkbox" checked={selected} onChange={onSelect} className="h-3.5 w-3.5" />
          Compare
        </label>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">{PROVIDER_LABEL[r.provider]}</span>
            <span>{fnLabel(r.modelFunction)}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold leading-snug">{r.modelName}</h3>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            {!active && <span>took {r.runtimeS ? `${Math.round(r.runtimeS)}s` : elapsed(r, now)}</span>}
            {money(r) && <span>{money(r)}</span>}
          </div>
          <ArchiveBadge r={r} onRetry={onRetryArchive} />
        </div>
        {r.prompt && (
          <button onClick={() => setShowPrompt((s) => !s)} className={`text-left text-xs text-muted ${showPrompt ? "" : "line-clamp-2"}`}>
            {r.prompt}
          </button>
        )}
        {r.inputFileNames.length > 0 && <p className="truncate text-[11px] text-muted" title={r.inputFileNames.join(", ")}>Files: {r.inputFileNames.join(", ")}</p>}
        <Stars value={r.rating} onChange={(v) => onUpdate({ rating: v })} />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (r.notes ?? "") && onUpdate({ notes })}
          rows={2}
          placeholder="Notes: realism, motion, artifacts, prompt adherence…"
          className="w-full rounded-md border border-line p-2 text-xs outline-none focus:border-accent"
        />
        <div className="mt-auto flex flex-wrap gap-3 pt-1 text-xs">
          <button onClick={onReuse} className="text-accent hover:underline">Reuse settings</button>
          {r.videoPath && r.archiveStatus === "stored" ? (
            <a href={`/api/runs/${r.id}/video?redirect=1&download=1`} className="text-accent hover:underline">Download ↓</a>
          ) : (
            r.providerVideoUrl && <a href={r.providerVideoUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open / download ↗</a>
          )}
          <button onClick={onDelete} className="ml-auto text-muted hover:text-bad">Delete</button>
        </div>
      </div>
    </article>
  );
}

function CompareView({ runs, onClose }: { runs: Run[]; onClose: () => void }) {
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const all = (fn: (v: HTMLVideoElement) => void) => refs.current.forEach((v) => v && fn(v));
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg/95 p-4 backdrop-blur" role="dialog" aria-modal="true" aria-label="Compare runs">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Side-by-side ({runs.length})</h2>
        <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm" onClick={() => all((v) => { v.currentTime = 0; void v.play(); })}>Play all from start</button>
        <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm" onClick={() => all((v) => v.pause())}>Pause all</button>
        <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm" onClick={() => { setMuted((m) => !m); }}>{muted ? "Unmute" : "Mute"}</button>
        <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg" onClick={onClose}>Close</button>
      </div>
      <div className={`grid min-h-0 flex-1 gap-3 overflow-auto ${runs.length > 2 ? "md:grid-cols-2" : runs.length === 2 ? "md:grid-cols-2" : ""}`}>
        {runs.map((r, i) => (
          <div key={r.id} className="flex min-h-0 flex-col rounded-xl border border-line bg-panel p-2">
            <RunVideo
              run={r}
              videoRef={(el) => { refs.current[i] = el; }}
              controls
              playsInline
              loop
              muted={muted}
              className="aspect-video w-full rounded-lg bg-black object-contain"
            />
            <div className="mt-2 px-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{r.modelName}</span>
                <span className="text-xs text-muted">{PROVIDER_LABEL[r.provider]} {r.rating ? `· ${"★".repeat(r.rating)}` : ""}</span>
              </div>
              <p className="line-clamp-2 text-xs text-muted">{r.prompt}</p>
              {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Results({ runs, onUpdate, onDelete, onReuse, onRetryArchive }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [providerFilter, setProviderFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const anyActive = runs.some((r) => ACTIVE.has(r.status));

  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyActive]);

  const modelOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of runs) m.set(`${r.provider}:${r.modelId}`, r.modelName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);

  const shown = runs.filter(
    (r) =>
      (providerFilter === "all" || r.provider === providerFilter) &&
      (modelFilter === "all" || `${r.provider}:${r.modelId}` === modelFilter) &&
      (statusFilter === "all" ||
        (statusFilter === "active" ? ACTIVE.has(r.status) : statusFilter === "rated" ? !!r.rating : r.status === statusFilter)),
  );

  const compareRuns = runs.filter((r) => selected.includes(r.id) && hasVideo(r));

  function exportCsv() {
    const blob = new Blob([runsToCsv(shown)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rample-model-runs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sel = "rounded-lg border border-line bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className={sel} aria-label="Provider">
          <option value="all">All providers</option>
          <option value="pika">Pika</option>
          <option value="higgsfield">Higgsfield</option>
        </select>
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className={`${sel} max-w-64`} aria-label="Model">
          <option value="all">All models</option>
          {modelOptions.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={sel} aria-label="Status">
          <option value="all">Any status</option>
          <option value="completed">Completed</option>
          <option value="active">In progress</option>
          <option value="failed">Failed</option>
          <option value="rated">Rated</option>
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            disabled={compareRuns.length < 2}
            onClick={() => setComparing(true)}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
            title="Tick 'Compare' on 2 to 6 finished videos"
          >
            Compare {compareRuns.length > 0 ? `(${compareRuns.length})` : ""}
          </button>
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} className="rounded-lg border border-line px-3 py-1.5 text-sm">Clear selection</button>
          )}
          <button onClick={exportCsv} disabled={!shown.length} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40">Export CSV</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">
          {runs.length ? "No runs match these filters." : "No runs yet. Generate a video and it will show up here."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((r) => (
            <RunCard
              key={r.id}
              r={r}
              now={now}
              selected={selected.includes(r.id)}
              onSelect={() =>
                setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : s.length >= 6 ? s : [...s, r.id]))
              }
              onUpdate={(p) => onUpdate(r.id, p)}
              onDelete={() => {
                if (!confirm(`Delete this ${r.modelName} run for the whole team?`)) return;
                setSelected((s) => s.filter((x) => x !== r.id));
                onDelete(r.id);
              }}
              onReuse={() => onReuse(r)}
              onRetryArchive={() => onRetryArchive(r.id)}
            />
          ))}
        </div>
      )}

      {comparing && compareRuns.length >= 2 && <CompareView runs={compareRuns} onClose={() => setComparing(false)} />}
    </div>
  );
}

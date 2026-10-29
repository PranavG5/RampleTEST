"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runsToCsv } from "@/lib/history";
import { PROVIDER_LABEL, type Run } from "@/lib/types";
import { fnLabel } from "./ModelPicker";
import RunVideo from "./RunVideo";

interface Props {
  runs: Run[];
  onUpdate: (id: string, patch: Partial<Run>) => void;
  onDelete: (id: string) => Promise<void>;
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

// Finished, but the copy into Storage failed (or never started): only the provider's expiring link is left.
const isUnsaved = (r: Run) => hasVideo(r) && (r.archiveStatus === "failed" || !r.archiveStatus);

// Deleting is refused (here and on the server) while the run can still change.
function deleteBlockedReason(r: Run): string | null {
  if (ACTIVE.has(r.status)) return "Can't delete while the video is being generated";
  if (r.archiveStatus === "pending" || r.archiveStatus === "uploading") return "Can't delete while the video is being saved";
  return null;
}

const cost = (r: Run) => r.costUsd ?? r.quotedUsd;
const runtime = (r: Run) => r.runtimeS ?? (r.finishedAt ? (r.finishedAt - r.createdAt) / 1000 : undefined);

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
          <button
            onClick={onDelete}
            disabled={!!deleteBlockedReason(r)}
            title={deleteBlockedReason(r) ?? "Delete this video permanently"}
            className="ml-auto text-muted hover:text-bad disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

// Second check before an unrecoverable delete: the button stays disabled until
// the word "delete" is typed.
function DeleteDialog({ run, onCancel, onConfirm }: { run: Run; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toLowerCase() === "delete" && !busy;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function confirmDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <form onSubmit={confirmDelete} className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-lg">
        <h2 id="delete-title" className="text-lg font-semibold">Delete this video permanently?</h2>
        <div className="mt-3 rounded-lg bg-panel-2 p-3 text-sm">
          <div className="font-medium">{run.modelName}</div>
          <div className="text-xs text-muted">
            {PROVIDER_LABEL[run.provider]} · {new Date(run.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {run.rating ? ` · ${"★".repeat(run.rating)}` : ""}
          </div>
          {run.prompt && <p className="mt-1 line-clamp-2 text-xs text-muted">{run.prompt}</p>}
        </div>
        <p className="mt-3 text-sm">
          This removes the video file and everything saved with it (prompt, settings, rating, notes) for the whole team.{" "}
          <strong>It can&apos;t be undone.</strong>
        </p>
        <label htmlFor="delete-confirm" className="mt-4 block text-sm">
          Type <span className="font-mono font-semibold">delete</span> to confirm
        </label>
        <input
          id="delete-confirm"
          autoFocus
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-bad"
        />
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={!ready} className="rounded-lg bg-bad px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {busy ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </form>
    </div>
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

type SortKey = "newest" | "oldest" | "model" | "rating" | "cost-low" | "cost-high" | "fastest" | "slowest";

interface View {
  search: string;
  provider: string;
  model: string;
  type: string;
  status: string;
  minRating: number;
  sort: SortKey;
  group: boolean;
}

const DEFAULT_VIEW: View = { search: "", provider: "all", model: "all", type: "all", status: "all", minRating: 0, sort: "newest", group: false };
const VIEW_KEY = "rample-model-lab:results-view:v1";

function loadView(): View {
  try {
    return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<View>) };
  } catch {
    return DEFAULT_VIEW;
  }
}

// Missing values (unrated, no cost, unknown runtime) always sort last.
function compareBy(sort: SortKey): (a: Run, b: Run) => number {
  const last = (x: number | undefined, y: number | undefined, dir: 1 | -1) =>
    x === undefined && y === undefined ? 0 : x === undefined ? 1 : y === undefined ? -1 : (x - y) * dir;
  switch (sort) {
    case "oldest":
      return (a, b) => a.createdAt - b.createdAt;
    case "model":
      return (a, b) => a.modelName.localeCompare(b.modelName) || b.createdAt - a.createdAt;
    case "rating":
      return (a, b) => last(a.rating, b.rating, -1) || b.createdAt - a.createdAt;
    case "cost-low":
      return (a, b) => last(cost(a), cost(b), 1) || b.createdAt - a.createdAt;
    case "cost-high":
      return (a, b) => last(cost(a), cost(b), -1) || b.createdAt - a.createdAt;
    case "fastest":
      return (a, b) => last(runtime(a), runtime(b), 1) || b.createdAt - a.createdAt;
    case "slowest":
      return (a, b) => last(runtime(a), runtime(b), -1) || b.createdAt - a.createdAt;
    default:
      return (a, b) => b.createdAt - a.createdAt;
  }
}

function matchesStatus(r: Run, status: string): boolean {
  switch (status) {
    case "all":
      return true;
    case "active":
      return ACTIVE.has(r.status);
    case "unsaved":
      return isUnsaved(r);
    case "unrated":
      return r.status === "completed" && !r.rating;
    default:
      return r.status === status;
  }
}

export default function Results({ runs, onUpdate, onDelete, onReuse, onRetryArchive }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [deleting, setDeleting] = useState<Run | null>(null);
  const [view, setViewState] = useState<View>(DEFAULT_VIEW);
  const anyActive = runs.some((r) => ACTIVE.has(r.status));

  // Filters and sort are remembered per browser.
  useEffect(() => setViewState(loadView()), []);
  const setView = (patch: Partial<View>) =>
    setViewState((v) => {
      const next = { ...v, ...patch };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyActive]);

  const modelOptions = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of runs) {
      const k = `${r.provider}:${r.modelId}`;
      m.set(k, { name: r.modelName, count: (m.get(k)?.count ?? 0) + 1 });
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [runs]);

  const typeOptions = useMemo(() => [...new Set(runs.map((r) => r.modelFunction).filter(Boolean))].sort(), [runs]);

  const shown = useMemo(() => {
    const q = view.search.trim().toLowerCase();
    return runs
      .filter(
        (r) =>
          (view.provider === "all" || r.provider === view.provider) &&
          (view.model === "all" || `${r.provider}:${r.modelId}` === view.model) &&
          (view.type === "all" || r.modelFunction === view.type) &&
          matchesStatus(r, view.status) &&
          (!view.minRating || (r.rating ?? 0) >= view.minRating) &&
          (!q || [r.modelName, r.modelId, r.prompt, r.notes ?? "", ...r.inputFileNames].some((t) => t.toLowerCase().includes(q))),
      )
      .sort(compareBy(view.sort));
  }, [runs, view]);

  // With "Group by model", one section per model in A-Z order; each keeps the chosen sort.
  const groups = useMemo(() => {
    if (!view.group) return [{ key: "all", title: "", runs: shown }];
    const m = new Map<string, Run[]>();
    for (const r of shown) {
      const k = `${r.provider}:${r.modelId}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()]
      .map(([key, rs]) => ({ key, title: rs[0].modelName, runs: rs }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [shown, view.group]);

  const compareRuns = runs.filter((r) => selected.includes(r.id) && hasVideo(r));
  const unsavedCount = runs.filter(isUnsaved).length;
  const filtersOn = JSON.stringify({ ...view, sort: "newest", group: false }) !== JSON.stringify({ ...DEFAULT_VIEW });

  function exportCsv() {
    const blob = new Blob([runsToCsv(shown)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rample-model-runs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sel = "rounded-lg border border-line bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent";

  const card = (r: Run) => (
    <RunCard
      key={r.id}
      r={r}
      now={now}
      selected={selected.includes(r.id)}
      onSelect={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : s.length >= 6 ? s : [...s, r.id]))}
      onUpdate={(p) => onUpdate(r.id, p)}
      onDelete={() => setDeleting(r)}
      onReuse={() => onReuse(r)}
      onRetryArchive={() => onRetryArchive(r.id)}
    />
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={view.search}
          onChange={(e) => setView({ search: e.target.value })}
          placeholder="Search prompt, model, notes…"
          aria-label="Search runs"
          className={`${sel} w-full sm:w-64`}
        />
        <select value={view.provider} onChange={(e) => setView({ provider: e.target.value })} className={sel} aria-label="Provider">
          <option value="all">All providers</option>
          <option value="pika">Pika</option>
          <option value="higgsfield">Higgsfield</option>
        </select>
        <select value={view.model} onChange={(e) => setView({ model: e.target.value })} className={`${sel} max-w-64`} aria-label="Model">
          <option value="all">All models ({modelOptions.length})</option>
          {modelOptions.map(([k, m]) => (
            <option key={k} value={k}>
              {m.name} ({m.count})
            </option>
          ))}
        </select>
        <select value={view.type} onChange={(e) => setView({ type: e.target.value })} className={sel} aria-label="Model type">
          <option value="all">All types</option>
          {typeOptions.map((t) => <option key={t} value={t}>{fnLabel(t)}</option>)}
        </select>
        <select value={view.status} onChange={(e) => setView({ status: e.target.value })} className={sel} aria-label="Status">
          <option value="all">Any status</option>
          <option value="completed">Completed</option>
          <option value="active">In progress</option>
          <option value="failed">Failed</option>
          <option value="unrated">Not rated yet</option>
          <option value="unsaved">Not saved to library</option>
        </select>
        <select value={view.minRating} onChange={(e) => setView({ minRating: Number(e.target.value) })} className={sel} aria-label="Minimum rating">
          <option value={0}>Any rating</option>
          <option value={5}>★★★★★ only</option>
          <option value={4}>★★★★ and up</option>
          <option value={3}>★★★ and up</option>
          <option value={2}>★★ and up</option>
          <option value={1}>★ and up</option>
        </select>
        <select value={view.sort} onChange={(e) => setView({ sort: e.target.value as SortKey })} className={sel} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="model">Model A–Z</option>
          <option value="rating">Highest rated</option>
          <option value="cost-low">Cheapest</option>
          <option value="cost-high">Most expensive</option>
          <option value="fastest">Fastest</option>
          <option value="slowest">Slowest</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={view.group} onChange={(e) => setView({ group: e.target.checked })} className="h-4 w-4" />
          Group by model
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          Showing {shown.length} of {runs.length}
        </span>
        {filtersOn && (
          <button onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort, group: view.group })} className="text-sm text-accent hover:underline">
            Clear filters
          </button>
        )}
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

      {unsavedCount > 0 && view.status !== "unsaved" && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm">
          <span className="text-bad">
            {unsavedCount} finished video{unsavedCount > 1 ? "s aren't" : " isn't"} saved to the team library yet. The provider&apos;s link expires after a few days.
          </span>
          <button onClick={() => setView({ status: "unsaved" })} className="font-medium text-accent hover:underline">Show them</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">
          {runs.length ? "No runs match these filters." : "No runs yet. Generate a video and it will show up here."}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className={view.group ? "mb-6" : ""}>
            {view.group && (
              <h2 className="mb-2 text-sm font-semibold">
                {g.title} <span className="font-normal text-muted">· {g.runs.length} run{g.runs.length > 1 ? "s" : ""}</span>
              </h2>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{g.runs.map(card)}</div>
          </section>
        ))
      )}

      {comparing && compareRuns.length >= 2 && <CompareView runs={compareRuns} onClose={() => setComparing(false)} />}
      {deleting && (
        <DeleteDialog
          run={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await onDelete(deleting.id);
            setSelected((s) => s.filter((x) => x !== deleting.id));
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

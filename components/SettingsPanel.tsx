"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PROVIDER_LABEL, type Provider } from "@/lib/types";
import type { UsageReport } from "@/lib/usage";
import { videoCacheUsage } from "@/lib/videoCache";

// Settings -> Storage & usage. Information only: nothing here changes data.

export const WARN_AT = 0.8;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function storageBytes(r: UsageReport): number {
  return r.supabase?.buckets.reduce((n, b) => n + b.bytes, 0) ?? 0;
}

// True when Supabase file storage or the database is at WARN_AT of its quota.
export function nearQuota(r: UsageReport): boolean {
  if (!r.supabase) return false;
  return storageBytes(r) >= WARN_AT * r.quotas.storageBytes || r.supabase.database_bytes >= WARN_AT * r.quotas.databaseBytes;
}

function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? used / total : 0;
  const tone = pct >= 0.9 ? "bg-bad" : pct >= 0.7 ? "bg-warn" : "bg-ok";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          {formatSize(used)} of {formatSize(total)} · {Math.round(pct * 100)}%
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
      >
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function SettingsPanel({ onClose, onReport }: { onClose: () => void; onReport: (r: UsageReport) => void }) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<ReturnType<typeof videoCacheUsage> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCache(videoCacheUsage());
    try {
      const r = await api<UsageReport>("/api/usage");
      setReport(r);
      onReport(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onReport]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = report?.supabase;
  const videos = s?.videos.visible;
  const avg = videos && videos.files ? videos.bytes / videos.files : 0;
  const used = report ? storageBytes(report) : 0;
  const roomFor = report && avg ? Math.max(0, Math.floor((report.quotas.storageBytes - used) / avg)) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="w-full max-w-xl rounded-2xl border border-line bg-panel p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="mr-auto">
            <h2 id="settings-title" className="text-lg font-semibold">Settings</h2>
            <p className="text-sm text-muted">Storage &amp; usage · information only</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="text-sm text-accent hover:underline disabled:opacity-50">
            {loading ? "Checking…" : "Refresh"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Close</button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {error && <p className="text-sm text-bad">Couldn&apos;t load usage: {error}</p>}
          {!report && !error && <p className="text-sm text-muted">Checking storage…</p>}

          {report && !s && (
            <div className="rounded-lg bg-panel-2 p-3 text-sm">
              <p className="font-medium">One-time setup needed</p>
              <p className="mt-1 text-muted">
                To see Supabase numbers here, run <span className="font-mono text-xs">supabase/migrations/20261029000002_usage_stats.sql</span> once in the
                Supabase SQL Editor.
              </p>
            </div>
          )}

          {report && s && videos && (
            <>
              <div className="flex flex-col gap-3">
                <Meter label="Supabase file storage" used={used} total={report.quotas.storageBytes} />
                <Meter label="Supabase database" used={s.database_bytes} total={report.quotas.databaseBytes} />
              </div>

              <Section title="Videos">
                <Row label="Saved videos" value={`${plural(videos.files, "file")} · ${formatSize(videos.bytes)}`} />
                <Row label="Average size" value={avg ? formatSize(avg) : "–"} />
                {roomFor !== null && <Row label="Room left at that average" value={`about ${plural(roomFor, "more video")}`} />}
                <Row label="Runs" value={`${s.runs.total} total · ${s.runs.with_saved_video} with a saved video`} />
                {s.runs.video_not_saved > 0 && <Row label="Finished but not saved" value={plural(s.runs.video_not_saved, "video")} />}
              </Section>

              {s.videos.by_model.length > 0 && (
                <Section title="Space used by model">
                  {s.videos.by_model.map((m) => (
                    <Row
                      key={`${m.provider}:${m.model}`}
                      label={`${m.model} (${PROVIDER_LABEL[m.provider as Provider] ?? m.provider})`}
                      value={`${plural(m.files, "video")} · ${formatSize(m.bytes)}`}
                    />
                  ))}
                </Section>
              )}

              {(s.videos.hidden_soft_deleted.files > 0 || s.videos.without_run.files > 0) && (
                <Section title="Using space but not shown in Results">
                  {s.videos.hidden_soft_deleted.files > 0 && (
                    <Row
                      label="Runs deleted with the old Delete (hidden)"
                      value={`${plural(s.videos.hidden_soft_deleted.files, "file")} · ${formatSize(s.videos.hidden_soft_deleted.bytes)}`}
                    />
                  )}
                  {s.videos.without_run.files > 0 && (
                    <Row label="Files with no run" value={`${plural(s.videos.without_run.files, "file")} · ${formatSize(s.videos.without_run.bytes)}`} />
                  )}
                </Section>
              )}

              <Section title="Storage buckets">
                {s.buckets.map((b) => (
                  <Row key={b.bucket} label={`${b.bucket} (${b.public ? "public" : "private"})`} value={`${plural(b.files, "file")} · ${formatSize(b.bytes)}`} />
                ))}
              </Section>

              <Section title="Database tables">
                {s.tables.map((t) => (
                  <Row key={t.name} label={t.name} value={`${plural(t.rows, "row")} · ${formatSize(t.bytes)}`} />
                ))}
                <p className="mt-1 text-xs text-muted">A new Supabase project already uses about 40–60 MB of its database for built-in data.</p>
              </Section>
            </>
          )}

          {report && (
            <Section title="Outside Supabase">
              <Row
                label="Input uploads (Vercel Blob)"
                value={
                  !report.blob
                    ? "–"
                    : !report.blob.configured
                      ? "not connected"
                      : report.blob.error
                        ? `couldn't check (${report.blob.error})`
                        : `${plural(report.blob.files, "file")} · ${formatSize(report.blob.bytes)}${report.blob.truncated ? "+" : ""}`
                }
              />
              {cache && <Row label="This browser's video cache" value={`${plural(cache.files, "video")} · ${formatSize(cache.bytes)} of ${formatSize(cache.maxBytes)}`} />}
            </Section>
          )}

          {report && (
            <p className="border-t border-line pt-3 text-xs text-muted">
              These are live numbers. Supabase bills storage as the average over the month, so its own usage page can show less for a while. Downloads
              (egress, 5 GB a month on the Free plan) are only shown there.
              {report.dashboardUrl && (
                <>
                  {" "}
                  <a href={report.dashboardUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Open Supabase usage ↗
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

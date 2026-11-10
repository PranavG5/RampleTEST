"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PROVIDER_LABEL, type Provider } from "@/lib/types";
import type { SpendingStats } from "@/lib/db/spending";
import type { PikaBalance } from "@/lib/providers/pika";
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const money = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

type PikaMoney = { balance?: PikaBalance; spentThisMonthUsd?: number; error?: string };

// Money left on each provider account. Pika reports its balance; Higgsfield's
// API doesn't, so it links to its console.
function MoneyLeft({ pika }: { pika: PikaMoney }) {
  const b = pika.balance;
  return (
    <Section title="Money left">
      {b ? (
        <Row
          label={b.invoice ? "Pika (billed by invoice)" : "Pika"}
          value={
            <>
              <strong className={b.remainingUsd <= 0 ? "text-bad" : ""}>{money(b.remainingUsd)}</strong>
              <span className="text-muted">
                {b.invoice
                  ? ` left of ${money(b.invoice.limitUsd)} this period${b.invoice.windowEnd ? `, resets ${new Date(b.invoice.windowEnd).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}`
                  : b.creditUsd > 0
                    ? ` (${money(b.prepaidUsd)} prepaid + ${money(b.creditUsd)} free credits)`
                    : ""}
              </span>
            </>
          }
        />
      ) : (
        <Row label="Pika" value={<span className="text-warn">couldn&apos;t check: {pika.error ?? "no answer"}</span>} />
      )}
      <Row
        label="Higgsfield"
        value={
          <a href="https://console.higgsfield.ai" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            see console.higgsfield.ai ↗
          </a>
        }
      />
    </Section>
  );
}
const spent = (b: { exact: number; estimated: number }) => Number(b.exact) + Number(b.estimated);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString([], { month: "short", year: "numeric", timeZone: "UTC" });

// Settings -> Spending: what the team has spent on generations, from each
// run's confirmed Pika charge (or Pika's quote until it's confirmed).
function SpendingTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ stats: SpendingStats | null; pika: PikaMoney } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api<{ stats: SpendingStats | null; pika: PikaMoney }>("/api/spending")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) return <p className="mt-4 text-sm text-bad">Couldn&apos;t load spending: {error}</p>;
  if (!data) return <p className="mt-4 text-sm text-muted">Adding up spending…</p>;
  if (!data.stats) {
    return (
      <div className="mt-4 flex flex-col gap-4">
        <MoneyLeft pika={data.pika} />
        <div className="rounded-lg bg-panel-2 p-3 text-sm">
          <p className="font-medium">One-time setup needed</p>
          <p className="mt-1 text-muted">
            To see spending here, run <span className="font-mono text-xs">supabase/migrations/20261109000001_spending.sql</span> once in the Supabase SQL Editor.
          </p>
        </div>
      </div>
    );
  }

  const { totals, by_provider, by_model, by_month } = data.stats;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <MoneyLeft pika={data.pika} />
      <div className="border-t border-line pt-4">
        <div className="text-3xl font-semibold tabular-nums">{money(spent(totals.total))}</div>
        <p className="text-sm text-muted">
          spent in total on {plural(Number(totals.total.runs), "run")} · {money(Number(totals.total.exact))} confirmed by Pika
          {Number(totals.total.estimated) > 0 && <> · {money(Number(totals.total.estimated))} estimated</>}
        </p>
      </div>

      <Section title="Recent">
        <Row label="This month (UTC)" value={`${money(spent(totals.this_month))} · ${plural(Number(totals.this_month.runs), "run")}`} />
        <Row label="Last 30 days" value={`${money(spent(totals.last_30_days))} · ${plural(Number(totals.last_30_days.runs), "run")}`} />
        {data.pika.spentThisMonthUsd !== undefined && (
          <Row label="Pika's own record, this month (whole Pika account)" value={money(data.pika.spentThisMonthUsd)} />
        )}
      </Section>

      <Section title="By provider">
        {by_provider.map((p) => (
          <Row
            key={p.provider}
            label={PROVIDER_LABEL[p.provider as Provider] ?? p.provider}
            value={
              spent(p) === 0 && Number(p.unpriced) > 0
                ? `${plural(Number(p.runs), "run")} · price not reported`
                : `${money(spent(p))} · ${plural(Number(p.runs), "run")}`
            }
          />
        ))}
      </Section>

      {by_model.length > 0 && (
        <Section title="By model">
          {by_model.map((m) => (
            <Row
              key={`${m.provider}:${m.model}`}
              label={`${m.model} (${PROVIDER_LABEL[m.provider as Provider] ?? m.provider})`}
              value={`${spent(m) ? money(spent(m)) : "–"} · ${plural(Number(m.runs), "run")}`}
            />
          ))}
        </Section>
      )}

      {by_month.length > 0 && (
        <Section title="By month (UTC)">
          {by_month.map((m) => (
            <Row key={m.month} label={monthLabel(m.month)} value={`${money(spent(m))} · ${plural(Number(m.runs), "run")}`} />
          ))}
        </Section>
      )}

      <p className="border-t border-line pt-3 text-xs text-muted">
        &quot;Confirmed&quot; is the charge Pika reported for each job. &quot;Estimated&quot; is Pika&apos;s quote at Generate, used until Pika confirms the
        charge. Includes runs that were deleted later
        {Number(totals.deleted.runs) > 0 ? ` (${plural(Number(totals.deleted.runs), "run")}, ${money(spent(totals.deleted))})` : ""}.
        {Number(totals.total.unpriced) > 0 && (
          <>
            {" "}
            {plural(Number(totals.total.unpriced), "finished run")} {Number(totals.total.unpriced) === 1 ? "has" : "have"} no price because Higgsfield
            doesn&apos;t report prices to the app; see{" "}
            <a href="https://console.higgsfield.ai" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              console.higgsfield.ai ↗
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}

export default function SettingsPanel({ onClose, onReport }: { onClose: () => void; onReport: (r: UsageReport) => void }) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<ReturnType<typeof videoCacheUsage> | null>(null);

  const [tab, setTab] = useState<"storage" | "spending">("storage");
  const [spendKey, setSpendKey] = useState(0);

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
            <p className="text-sm text-muted">Information only</p>
          </div>
          <button
            onClick={() => (tab === "storage" ? void load() : setSpendKey((k) => k + 1))}
            disabled={loading}
            className="text-sm text-accent hover:underline disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Close</button>
        </div>

        <div className="mt-3 flex gap-1 rounded-lg bg-panel-2 p-1 text-sm" role="tablist" aria-label="Settings sections">
          {(["storage", "spending"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1 font-medium transition ${tab === t ? "bg-panel shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {t === "storage" ? "Storage" : "Spending"}
            </button>
          ))}
        </div>

        {tab === "spending" ? (
          <SpendingTab refreshKey={spendKey} />
        ) : (
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
        )}
      </div>
    </div>
  );
}

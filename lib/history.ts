// Run history. Supabase is the source of truth (through /api/runs); this
// browser keeps a copy in localStorage so the Results list shows instantly on
// load, then the server's version replaces it.

import { api, jsonBody } from "./api";
import type { PromptDraft, Provider, Run, RunInput } from "./types";

const KEY = "rample-model-lab:runs:v2";

export function loadCachedRuns(): Run[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Run[]) : [];
  } catch {
    return [];
  }
}

export function cacheRuns(runs: Run[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs.slice(0, 500)));
  } catch {
    // Storage full or blocked; the server still has everything.
  }
}

export function clearRunCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// Full list, used on first load.
export async function fetchRuns(): Promise<{ runs: Run[]; cursor: string }> {
  return api<{ runs: Run[]; cursor: string }>("/api/runs");
}

// Only what changed since `cursor`, plus the ids of every run (to spot deletions).
export async function fetchRunChanges(cursor: string): Promise<{ runs: Run[]; ids: string[]; cursor: string }> {
  return api(`/api/runs?since=${encodeURIComponent(cursor)}`);
}

// Applies a change set: newer server versions replace local ones, runs missing
// from `ids` were deleted by someone. A run this tab just created stays even if
// the server hasn't listed it yet.
export function mergeRunChanges(local: Run[], changed: Run[], ids: string[] | null): Run[] {
  const alive = ids ? new Set(ids) : null;
  const byId = new Map<string, Run>();
  for (const r of local) {
    const justCreated = Date.now() - r.createdAt < 120_000 && !r.updatedAt;
    if (!alive || alive.has(r.id) || justCreated) byId.set(r.id, r);
  }
  for (const r of changed) {
    const mine = byId.get(r.id);
    if (!mine || (r.updatedAt ?? 0) >= (mine.updatedAt ?? 0)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export interface NewRunRequest {
  id: string;
  provider: Provider;
  modelId: string;
  modelName: string;
  modelFunction: string;
  prompt: string;
  status: "uploading" | "submitting";
  promptDraft?: PromptDraft;
  inputs: RunInput[];
}

export async function createRun(r: NewRunRequest): Promise<Run> {
  return (await api<{ run: Run }>("/api/runs", jsonBody("POST", r))).run;
}

export async function startRun(runId: string, input: Record<string, unknown>, inputUrls: Record<string, string>): Promise<Run> {
  return (await api<{ run: Run }>("/api/generate", jsonBody("POST", { runId, input, inputUrls }))).run;
}

export async function pollRun(runId: string): Promise<Run> {
  return (await api<{ run: Run }>(`/api/jobs?runId=${encodeURIComponent(runId)}`)).run;
}

export async function patchRun(runId: string, patch: Partial<Pick<Run, "rating" | "notes" | "tags">> | { status: "failed"; error: string }): Promise<Run | null> {
  // JSON drops undefined, so a cleared rating is sent as null.
  const body = "rating" in patch && patch.rating === undefined ? { ...patch, rating: null } : patch;
  return (await api<{ run: Run | null }>(`/api/runs/${runId}`, jsonBody("PATCH", body))).run;
}

// Permanent. The server refuses without the run id repeated as confirmation.
export async function deleteRunPermanently(runId: string): Promise<{ videoRemoved: boolean }> {
  return api(`/api/runs/${runId}`, jsonBody("DELETE", { confirm: runId }));
}

export async function retryArchive(runId: string): Promise<Run> {
  return (await api<{ run: Run }>(`/api/runs/${runId}/archive`, { method: "POST" })).run;
}

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function runsToCsv(runs: Run[]): string {
  const cols: (keyof Run)[] = [
    "createdAt", "provider", "modelName", "modelId", "modelFunction", "status", "rating", "notes",
    "prompt", "runtimeS", "quotedUsd", "costUsd", "videoPath", "providerVideoUrl", "error", "inputFileNames", "input",
  ];
  const lines = [cols.join(",")];
  for (const r of runs) {
    lines.push(
      cols
        .map((c) => (c === "createdAt" ? new Date(r.createdAt).toISOString() : csvCell(r[c])))
        .join(","),
    );
  }
  return lines.join("\n");
}

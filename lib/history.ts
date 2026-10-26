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

export async function fetchRuns(): Promise<Run[]> {
  const { runs } = await api<{ runs: Run[] }>("/api/runs");
  cacheRuns(runs);
  return runs;
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

export async function deleteRun(runId: string): Promise<void> {
  await api(`/api/runs/${runId}`, { method: "DELETE" });
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

// Run history for comparing models. Kept in this browser's localStorage for now.
// Everything goes through this small interface, so swapping in Supabase later
// means replacing these functions, not the UI.

import type { Run } from "./types";

const KEY = "rample-model-lab:runs:v1";

export function loadRuns(): Run[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Run[]) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: Run[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs.slice(0, 500)));
  } catch {
    // Storage full or blocked; the session still works, it just won't persist.
  }
}

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function runsToCsv(runs: Run[]): string {
  const cols: (keyof Run)[] = [
    "createdAt", "provider", "modelName", "modelId", "modelFunction", "status", "rating", "notes",
    "prompt", "runtimeS", "quotedUsd", "costUsd", "videoUrl", "error", "inputFileNames", "input",
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

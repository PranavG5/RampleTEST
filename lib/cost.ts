import type { Run } from "./types";

// Pika can settle a job's charge shortly after the job finishes. A finished
// Pika run without a confirmed cost is checked again for this long.
export const COST_SETTLE_WINDOW_MS = 15 * 60 * 1000;

export function awaitingCost(r: Run, now = Date.now()): boolean {
  return (
    r.provider === "pika" &&
    !!r.jobId &&
    (r.status === "completed" || r.status === "failed") &&
    r.costUsd === undefined &&
    !!r.finishedAt &&
    now - r.finishedAt < COST_SETTLE_WINDOW_MS
  );
}

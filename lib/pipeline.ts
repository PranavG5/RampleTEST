import "server-only";
import { after } from "next/server";
import { archiveVideo, getRun, setInputUrls, updateRun } from "./db";
import { jobStatus, quote, submit } from "./providers";
import { ProviderError } from "./server";
import type { Run } from "./types";

// Moves a run through the pipeline and records every step on its row:
// uploading -> submitting -> queued -> running -> completed | failed,
// then copies the finished video into Storage in the background.

const STALE_CLAIM_MS = 10 * 60 * 1000; // matches claim_video_archive

async function mustGet(id: string): Promise<Run> {
  const run = await getRun(id);
  if (!run) throw new ProviderError(404, "Run not found");
  return run;
}

// Called once the browser has uploaded the input files. Provider and model come
// from the saved run, not from the request.
export async function startGeneration(runId: string, input: Record<string, unknown>, inputUrls: Record<string, string>): Promise<Run> {
  const run = await mustGet(runId);
  if (run.jobId || (run.status !== "uploading" && run.status !== "submitting")) {
    throw new ProviderError(409, "This run was already sent to the provider");
  }
  await updateRun(runId, { status: "submitting", input });
  if (Object.keys(inputUrls).length) await setInputUrls(runId, inputUrls);
  try {
    // Pika's quote is free and validates the body before any money is spent.
    const quotedUsd = await quote(run.provider, run.modelId, input);
    const jobId = await submit(run.provider, run.modelId, input);
    return (await updateRun(runId, { jobId, status: "queued", quotedUsd })) ?? mustGet(runId);
  } catch (e) {
    await updateRun(runId, { status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() }).catch((err) =>
      console.error("Couldn't mark run as failed:", err),
    );
    throw e;
  }
}

function archiveMayBeDue(r: Run): boolean {
  if (r.status !== "completed" || !r.providerVideoUrl) return false;
  switch (r.archiveStatus) {
    case "pending":
      return true;
    case "failed":
      return !!r.archiveRetryAt && r.archiveRetryAt <= Date.now();
    case "uploading":
      return !!r.updatedAt && Date.now() - r.updatedAt > STALE_CLAIM_MS;
    default:
      return false;
  }
}

// Starts the Storage copy after the response is sent. Safe to call from many
// requests at once: claim_video_archive lets only one of them do the work.
export function scheduleArchive(run: Run): void {
  if (!archiveMayBeDue(run)) return;
  const id = run.id;
  after(() => archiveVideo(id));
}

// One poll: ask the provider for the job's state, save any change, and start
// the video copy when it's due. Returns the run as saved.
export async function pollRun(runId: string): Promise<Run> {
  let run = await mustGet(runId);
  if (run.jobId && (run.status === "queued" || run.status === "running")) {
    const j = await jobStatus(run.provider, run.jobId);
    const done = j.status === "completed" || j.status === "failed";
    if (j.status !== run.status) {
      const updated = await updateRun(
        runId,
        {
          status: j.status,
          error: j.error ?? null,
          providerVideoUrl: j.videoUrl ?? null,
          costUsd: j.costUsd ?? null,
          runtimeS: j.runtimeS ?? null,
          ...(done ? { finishedAt: Date.now() } : {}),
          ...(j.status === "completed" && j.videoUrl ? { archiveStatus: "pending" as const } : {}),
        },
        // Another poller may have finished it first; don't overwrite its result.
        { onlyIfStatusIn: ["queued", "running"] },
      );
      run = updated ?? (await mustGet(runId));
    }
  }
  scheduleArchive(run);
  return run;
}

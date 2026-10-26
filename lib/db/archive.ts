import "server-only";
import { adminClient } from "./client";
import { videoMaxBytes } from "./env";
import { uploadVideo } from "./storage";

// Copies a finished video from the provider's (expiring) URL into the private
// bucket. Runs in the background after a response is sent, with the secret key.
//
// Nothing is lost on failure: the provider URL stays on the run and keeps playing,
// the run is marked failed with a retry time, and the next poll or page load
// tries again with backoff (30 s, 1 min, 2 min, 4 min). After 5 attempts it waits
// for someone to press "Retry save".

export const MAX_ARCHIVE_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;

class PermanentError extends Error {}

interface ClaimedRun {
  id: string;
  provider_video_url: string;
  archive_attempts: number;
}

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

async function download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const max = videoMaxBytes();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // The provider URL expired or vanished: retrying won't help.
    const err = `Provider returned ${res.status} for the video`;
    throw res.status === 403 || res.status === 404 || res.status === 410 ? new PermanentError(`${err} (link expired?)`) : new Error(err);
  }
  const tooBig = () => new PermanentError(`Video is larger than the ${max / 1024 / 1024} MB upload limit (VIDEO_MAX_MB)`);
  if (Number(res.headers.get("content-length")) > max) throw tooBig();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > max) throw tooBig();
  if (!bytes.byteLength) throw new Error("Provider returned an empty video");
  const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  return { bytes, contentType: type.startsWith("video/") ? type : "video/mp4" };
}

export async function archiveVideo(runId: string): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.rpc("claim_video_archive", { p_run_id: runId, p_max_attempts: MAX_ARCHIVE_ATTEMPTS });
  if (error) {
    console.error(`Video copy claim failed for run ${runId}:`, error.message);
    return;
  }
  const run = (data as ClaimedRun[] | null)?.[0];
  if (!run) return; // not due, already stored, or another request has it

  try {
    const { bytes, contentType } = await download(run.provider_video_url);
    const path = `runs/${run.id}/output.${EXT[contentType] ?? "mp4"}`;
    await uploadVideo(path, bytes, contentType);
    const { error: saveError } = await admin
      .from("runs")
      .update({ archive_status: "stored", video_path: path, video_bytes: bytes.byteLength, video_content_type: contentType, archive_error: null })
      .eq("id", run.id);
    if (saveError) throw new Error(`Video uploaded but the run couldn't be updated: ${saveError.message}`);
  } catch (e) {
    const permanent = e instanceof PermanentError;
    const outOfAttempts = run.archive_attempts >= MAX_ARCHIVE_ATTEMPTS;
    const retryAt = permanent || outOfAttempts ? null : new Date(Date.now() + RETRY_BASE_MS * 2 ** (run.archive_attempts - 1)).toISOString();
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Video copy failed for run ${run.id} (attempt ${run.archive_attempts}):`, message);
    await admin
      .from("runs")
      .update({
        archive_status: "failed",
        archive_error: message,
        archive_retry_at: retryAt,
        ...(permanent ? { archive_attempts: MAX_ARCHIVE_ATTEMPTS } : {}),
      })
      .eq("id", run.id);
  }
}

// Picks up copies that are due again (failed with backoff elapsed, or never
// started because the request that should have started them died).
export async function retryDueArchives(limit = 3): Promise<void> {
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // same window as claim_video_archive
  const { data, error } = await adminClient()
    .from("runs")
    .select("id")
    .eq("status", "completed")
    .or(
      `archive_status.eq.pending,and(archive_status.eq.failed,archive_retry_at.lte.${now}),and(archive_status.eq.uploading,updated_at.lt.${stale})`,
    )
    .lt("archive_attempts", MAX_ARCHIVE_ATTEMPTS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Couldn't look for pending video copies:", error.message);
    return;
  }
  for (const { id } of data as { id: string }[]) await archiveVideo(id);
}

import "server-only";
import type { ArchiveStatus, PromptDraft, Provider, Run, RunInput, RunStatus } from "../types";
import { adminClient, userClient } from "./client";

// Runs table access. Every call acts as the signed-in user, so RLS applies.

interface RunRow {
  id: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  provider: Provider;
  model_id: string;
  model_name: string;
  model_function: string;
  prompt: string;
  input: Record<string, unknown>;
  prompt_draft: PromptDraft | null;
  status: RunStatus;
  job_id: string | null;
  error: string | null;
  quoted_usd: number | string | null;
  cost_usd: number | string | null;
  runtime_s: number | string | null;
  provider_video_url: string | null;
  video_path: string | null;
  video_bytes: number | null;
  archive_status: ArchiveStatus | null;
  archive_error: string | null;
  archive_retry_at: string | null;
  rating: number | null;
  notes: string;
  tags: string[];
  run_inputs?: { id: number; file_name: string }[];
}

const SELECT = "*, run_inputs(id, file_name)";
const INTERRUPTED_AFTER_MS = 15 * 60 * 1000;
const PAGE = 500;
const MAX_RUNS = 5000;
// Rows can commit with an updated_at slightly older than the newest one already
// seen, so each incremental check looks back this far (duplicates are harmless).
const CHANGES_OVERLAP_MS = 30_000;

const time = (t: string | null) => (t ? Date.parse(t) : undefined);
const num = (v: number | string | null) => (v === null ? undefined : Number(v));
const opt = <T>(v: T | null) => (v === null ? undefined : v);

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    provider: row.provider,
    modelId: row.model_id,
    modelName: row.model_name,
    modelFunction: row.model_function,
    prompt: row.prompt,
    input: row.input ?? {},
    inputFileNames: (row.run_inputs ?? []).sort((a, b) => a.id - b.id).map((i) => i.file_name),
    promptDraft: opt(row.prompt_draft),
    jobId: opt(row.job_id),
    status: row.status,
    providerVideoUrl: opt(row.provider_video_url),
    videoPath: opt(row.video_path),
    videoBytes: opt(row.video_bytes),
    archiveStatus: opt(row.archive_status),
    archiveError: opt(row.archive_error),
    archiveRetryAt: time(row.archive_retry_at),
    error: opt(row.error),
    quotedUsd: num(row.quoted_usd),
    costUsd: num(row.cost_usd),
    runtimeS: num(row.runtime_s),
    createdAt: Date.parse(row.created_at),
    updatedAt: time(row.updated_at),
    finishedAt: time(row.finished_at),
    rating: opt(row.rating),
    notes: row.notes || undefined,
    tags: row.tags,
  };
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

// Fields the server may change on a run. null clears a column.
export interface RunPatch {
  status?: RunStatus;
  jobId?: string;
  error?: string | null;
  input?: Record<string, unknown>;
  quotedUsd?: number | null;
  costUsd?: number | null;
  runtimeS?: number | null;
  providerVideoUrl?: string | null;
  finishedAt?: number | null;
  archiveStatus?: ArchiveStatus | null;
  rating?: number | null;
  notes?: string;
  tags?: string[];
}

const COLUMNS: Record<keyof RunPatch, string> = {
  status: "status",
  jobId: "job_id",
  error: "error",
  input: "input",
  quotedUsd: "quoted_usd",
  costUsd: "cost_usd",
  runtimeS: "runtime_s",
  providerVideoUrl: "provider_video_url",
  finishedAt: "finished_at",
  archiveStatus: "archive_status",
  rating: "rating",
  notes: "notes",
  tags: "tags",
};

function toRow(patch: RunPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch) as [keyof RunPatch, unknown][]) {
    if (v === undefined) continue;
    row[COLUMNS[k]] = k === "finishedAt" && typeof v === "number" ? new Date(v).toISOString() : v;
  }
  return row;
}

export interface NewRun {
  id: string;
  provider: Provider;
  modelId: string;
  modelName: string;
  modelFunction: string;
  prompt: string;
  status: Extract<RunStatus, "uploading" | "submitting">;
  promptDraft?: PromptDraft;
  inputs: RunInput[];
}

export async function createRun(r: NewRun): Promise<Run> {
  const supabase = await userClient();
  const { error } = await supabase.from("runs").insert({
    id: r.id,
    provider: r.provider,
    model_id: r.modelId,
    model_name: r.modelName,
    model_function: r.modelFunction,
    prompt: r.prompt,
    status: r.status,
    prompt_draft: r.promptDraft ?? null,
  });
  if (error) fail("Couldn't save the run", error);
  if (r.inputs.length) {
    const { error: inputsError } = await supabase.from("run_inputs").insert(
      r.inputs.map((i) => ({
        run_id: r.id,
        field: i.field ?? null,
        kind: i.kind,
        file_name: i.fileName,
        content_type: i.contentType ?? null,
        size_bytes: i.sizeBytes ?? null,
      })),
    );
    if (inputsError) fail("Couldn't save the run's input files", inputsError);
  }
  const run = await getRun(r.id);
  if (!run) throw new Error("Run was saved but can't be read back");
  return run;
}

export async function getRun(id: string): Promise<Run | null> {
  const supabase = await userClient();
  const { data, error } = await supabase.from("runs").select(SELECT).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) fail("Couldn't load the run", error);
  return data ? toRun(data as RunRow) : null;
}

// A run stuck before reaching the provider means the browser that started it closed.
async function failInterruptedRuns(): Promise<void> {
  const supabase = await userClient();
  const cutoff = new Date(Date.now() - INTERRUPTED_AFTER_MS).toISOString();
  const { error } = await supabase
    .from("runs")
    .update({ status: "failed", error: "Interrupted: the page closed before the job reached the provider.", finished_at: new Date().toISOString() })
    .in("status", ["uploading", "submitting"])
    .lt("created_at", cutoff)
    .is("deleted_at", null);
  if (error) console.error("Interrupted-run sweep failed:", error.message);
}

// Where the next incremental check starts: just before the newest change seen.
function nextCursor(runs: Run[], previous?: string): string {
  const newest = Math.max(0, ...runs.map((r) => r.updatedAt ?? 0));
  if (!newest) return previous ?? new Date(Date.now() - CHANGES_OVERLAP_MS).toISOString();
  return new Date(newest - CHANGES_OVERLAP_MS).toISOString();
}

// Every visible run, newest first, fetched in pages.
export async function listRuns(): Promise<{ runs: Run[]; cursor: string }> {
  await failInterruptedRuns();
  const supabase = await userClient();
  const runs: Run[] = [];
  for (let from = 0; from < MAX_RUNS; from += PAGE) {
    const { data, error } = await supabase
      .from("runs")
      .select(SELECT)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) fail("Couldn't load runs", error);
    runs.push(...(data as RunRow[]).map(toRun));
    if (data.length < PAGE) break;
  }
  return { runs, cursor: nextCursor(runs) };
}

// What changed since `since`, plus the ids of every visible run so the browser
// can drop runs that were deleted. Much smaller than the full list.
export async function listRunChanges(since: string): Promise<{ runs: Run[]; ids: string[]; cursor: string }> {
  await failInterruptedRuns();
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("runs")
    .select(SELECT)
    .is("deleted_at", null)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(MAX_RUNS);
  if (error) fail("Couldn't load changed runs", error);
  const ids: string[] = [];
  for (let from = 0; from < MAX_RUNS; from += 5 * PAGE) {
    const { data: page, error: idsError } = await supabase
      .from("runs")
      .select("id")
      .is("deleted_at", null)
      .order("id")
      .range(from, from + 5 * PAGE - 1);
    if (idsError) fail("Couldn't load run ids", idsError);
    ids.push(...(page as { id: string }[]).map((r) => r.id));
    if (page.length < 5 * PAGE) break;
  }
  const runs = (data as RunRow[]).map(toRun);
  return { runs, ids, cursor: nextCursor(runs, since) };
}

// Applies the patch and returns the updated run. With onlyIfStatusIn, the update
// only happens while the run is still in one of those statuses (returns null
// otherwise), so two pollers can't both move a run forward.
export async function updateRun(id: string, patch: RunPatch, opts: { onlyIfStatusIn?: RunStatus[] } = {}): Promise<Run | null> {
  const supabase = await userClient();
  let q = supabase.from("runs").update(toRow(patch)).eq("id", id).is("deleted_at", null);
  if (opts.onlyIfStatusIn) q = q.in("status", opts.onlyIfStatusIn);
  const { data, error } = await q.select(SELECT).maybeSingle();
  if (error) fail("Couldn't update the run", error);
  return data ? toRun(data as RunRow) : null;
}

export async function setInputUrls(runId: string, urls: Record<string, string>): Promise<void> {
  const supabase = await userClient();
  for (const [fileName, hostedUrl] of Object.entries(urls)) {
    const { error } = await supabase.from("run_inputs").update({ hosted_url: hostedUrl }).eq("run_id", runId).eq("file_name", fileName);
    if (error) fail("Couldn't save an input file URL", error);
  }
}

export class DeleteBlockedError extends Error {
  constructor(
    public status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

// Permanently removes a run row (with its status history and input records)
// and returns its video's storage path, if any, for the caller to remove.
// Refused while the provider is still generating or the video is being copied
// into Storage, so a delete can never race the upload and leave a stray file.
// Signed-in users have no DELETE rights (see the guardrails migration), so
// this runs with the secret key; the API route checks the session first.
export async function permanentlyDeleteRun(id: string): Promise<{ videoPath: string | null }> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("runs")
    .delete()
    .eq("id", id)
    .in("status", ["completed", "failed"])
    .or("archive_status.is.null,archive_status.eq.stored,archive_status.eq.failed")
    .select("id, video_path");
  if (error) fail("Couldn't delete the run", error);
  const row = (data as { id: string; video_path: string | null }[])[0];
  if (row) return { videoPath: row.video_path };

  // Nothing deleted: say why.
  const { data: current, error: readError } = await admin
    .from("runs")
    .select("status, archive_status")
    .eq("id", id)
    .maybeSingle();
  if (readError) fail("Couldn't check the run", readError);
  if (!current) throw new DeleteBlockedError(404, "This run doesn't exist (maybe someone already deleted it).");
  if (current.status !== "completed" && current.status !== "failed") {
    throw new DeleteBlockedError(409, "This video is still being generated. Delete it once it has finished or failed.");
  }
  throw new DeleteBlockedError(409, "This video is being saved to the team library right now. Try again in a minute.");
}

// "Retry save" after the automatic retries gave up.
export async function resetArchive(id: string): Promise<Run | null> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("runs")
    .update({ archive_status: "pending", archive_attempts: 0, archive_error: null, archive_retry_at: null })
    .eq("id", id)
    .eq("archive_status", "failed")
    .is("deleted_at", null)
    .select(SELECT)
    .maybeSingle();
  if (error) fail("Couldn't reset the video copy", error);
  return data ? toRun(data as RunRow) : null;
}

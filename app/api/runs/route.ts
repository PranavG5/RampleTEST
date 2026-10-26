import { after, NextResponse } from "next/server";
import { createRun, listRuns, retryDueArchives, type NewRun } from "@/lib/db";
import { parseProvider } from "@/lib/providers";
import { errorResponse, isSafeModelId, ProviderError, requireSession } from "@/lib/server";
import type { PromptDraft, RunInput } from "@/lib/types";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map((x) => x.slice(0, maxLen)) : [];

// The team's run history, newest first.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const runs = await listRuns();
    after(() => retryDueArchives());
    return NextResponse.json({ runs });
  } catch (e) {
    return errorResponse(e);
  }
}

function parseDraft(v: unknown): PromptDraft | undefined {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  return {
    idea: str(d.idea, 20_000),
    documents: strList(d.documents, 100, 300),
    mediaFiles: strList(d.mediaFiles, 100, 300),
    model: str(d.model, 100),
    draftedPrompt: str(d.draftedPrompt, 20_000),
  };
}

function parseInputs(v: unknown): RunInput[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).flatMap((x) => {
    const i = (x ?? {}) as Record<string, unknown>;
    if ((i.kind !== "image" && i.kind !== "video") || typeof i.fileName !== "string") return [];
    return [{
      field: typeof i.field === "string" ? i.field.slice(0, 200) : undefined,
      kind: i.kind,
      fileName: i.fileName.slice(0, 300),
      contentType: typeof i.contentType === "string" ? i.contentType.slice(0, 200) : undefined,
      sizeBytes: typeof i.sizeBytes === "number" && i.sizeBytes >= 0 ? Math.round(i.sizeBytes) : undefined,
    }];
  });
}

// Saves a new run the moment Generate is clicked, before any upload.
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    if (typeof b.id !== "string" || !UUID.test(b.id)) throw new ProviderError(400, "Invalid run id");
    const modelId = str(b.modelId, 300);
    if (!isSafeModelId(modelId)) throw new ProviderError(400, "Invalid model id");
    const run: NewRun = {
      id: b.id,
      provider: parseProvider(b.provider),
      modelId,
      modelName: str(b.modelName, 300) || modelId,
      modelFunction: str(b.modelFunction, 100),
      prompt: str(b.prompt, 50_000),
      status: b.status === "uploading" ? "uploading" : "submitting",
      promptDraft: parseDraft(b.promptDraft),
      inputs: parseInputs(b.inputs),
    };
    return NextResponse.json({ run: await createRun(run) });
  } catch (e) {
    return errorResponse(e);
  }
}

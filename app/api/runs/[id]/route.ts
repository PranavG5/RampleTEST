import { NextResponse } from "next/server";
import { DeleteBlockedError, permanentlyDeleteRun, removeRunVideos, updateRun, type RunPatch } from "@/lib/db";
import { errorResponse, ProviderError, requireSession } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edits from the Results screen (rating, notes, tags), or marking a run failed
// when the browser couldn't upload its input files.
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { id } = await params;
    const b = (await req.json()) as Record<string, unknown>;
    if (b.status === "failed") {
      const run = await updateRun(
        id,
        { status: "failed", error: typeof b.error === "string" ? b.error.slice(0, 5000) : "Failed", finishedAt: Date.now() },
        { onlyIfStatusIn: ["uploading", "submitting"] },
      );
      return NextResponse.json({ run });
    }
    const patch: RunPatch = {};
    if ("rating" in b) {
      if (b.rating !== null && !(Number.isInteger(b.rating) && (b.rating as number) >= 1 && (b.rating as number) <= 5)) {
        throw new ProviderError(400, "Rating must be 1 to 5");
      }
      patch.rating = b.rating as number | null;
    }
    if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 20_000);
    if (Array.isArray(b.tags)) patch.tags = b.tags.filter((t): t is string => typeof t === "string").slice(0, 50);
    if (!Object.keys(patch).length) throw new ProviderError(400, "Nothing to update");
    const run = await updateRun(id, patch);
    if (!run) throw new ProviderError(404, "Run not found");
    return NextResponse.json({ run });
  } catch (e) {
    return errorResponse(e);
  }
}

// Permanent delete of one run and its video. Unrecoverable, so the request must
// repeat the run's id as { confirm: "<id>" } (the UI only sends it after the
// typed confirmation), and it is refused while the run is still in progress.
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new ProviderError(400, "Invalid run id");
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== id) throw new ProviderError(400, "Deleting needs confirmation: send { confirm: <run id> }.");
    const { videoPath } = await permanentlyDeleteRun(id);
    const videoRemoved = await removeRunVideos(id, videoPath);
    if (!videoRemoved) console.error(`Run ${id} deleted but its video files could not be removed.`);
    return NextResponse.json({ ok: true, videoRemoved });
  } catch (e) {
    if (e instanceof DeleteBlockedError) return NextResponse.json({ error: e.message }, { status: e.status });
    return errorResponse(e);
  }
}

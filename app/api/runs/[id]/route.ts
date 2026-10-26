import { NextResponse } from "next/server";
import { deleteRun, updateRun, type RunPatch } from "@/lib/db";
import { errorResponse, ProviderError, requireSession } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

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

// Soft delete: hidden for the whole team, recoverable in the database.
export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    await deleteRun((await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

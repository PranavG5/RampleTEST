import { NextResponse } from "next/server";
import { getRun, resetArchive } from "@/lib/db";
import { scheduleArchive } from "@/lib/pipeline";
import { errorResponse, ProviderError, requireSession } from "@/lib/server";

export const maxDuration = 300;

// "Retry save": start the copy into Storage again after it failed.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { id } = await params;
    const run = (await resetArchive(id)) ?? (await getRun(id));
    if (!run) throw new ProviderError(404, "Run not found");
    scheduleArchive(run);
    return NextResponse.json({ run });
  } catch (e) {
    return errorResponse(e);
  }
}

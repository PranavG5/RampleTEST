import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { pollRun } from "@/lib/pipeline";

// Long enough for the background copy of a finished video into Storage.
export const maxDuration = 300;

// Polls the provider for one run, saves any status change, and returns the run.
export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const runId = new URL(req.url).searchParams.get("runId") ?? "";
    return NextResponse.json({ run: await pollRun(runId) });
  } catch (e) {
    return errorResponse(e);
  }
}

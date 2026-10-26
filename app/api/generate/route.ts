import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { startGeneration } from "@/lib/pipeline";

// Submits a saved run to its provider. The run row records the final input,
// the quote, the job id and the status (or the error).
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const body = (await req.json()) as { runId?: string; input?: Record<string, unknown>; inputUrls?: Record<string, string> };
    if (!body.runId || !body.input || typeof body.input !== "object") {
      return NextResponse.json({ error: "Missing runId or input" }, { status: 400 });
    }
    const inputUrls = Object.fromEntries(
      Object.entries(body.inputUrls ?? {}).filter(([k, v]) => typeof k === "string" && typeof v === "string"),
    );
    const run = await startGeneration(body.runId, body.input, inputUrls);
    return NextResponse.json({ run });
  } catch (e) {
    return errorResponse(e);
  }
}

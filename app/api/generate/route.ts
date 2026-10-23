import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { parseProvider, submit } from "@/lib/providers";

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const body = (await req.json()) as { provider?: string; id?: string; input?: Record<string, unknown> };
    if (!body.input || typeof body.input !== "object") {
      return NextResponse.json({ error: "Missing input" }, { status: 400 });
    }
    const jobId = await submit(parseProvider(body.provider), body.id ?? "", body.input);
    return NextResponse.json({ jobId });
  } catch (e) {
    return errorResponse(e);
  }
}

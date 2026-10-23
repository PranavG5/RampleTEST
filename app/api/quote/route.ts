import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { parseProvider, quote } from "@/lib/providers";

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const body = (await req.json()) as { provider?: string; id?: string; input?: Record<string, unknown> };
    const usd = await quote(parseProvider(body.provider), body.id ?? "", body.input ?? {});
    return NextResponse.json({ usd });
  } catch (e) {
    return errorResponse(e);
  }
}

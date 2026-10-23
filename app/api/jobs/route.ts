import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { jobStatus, parseProvider } from "@/lib/providers";

export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const params = new URL(req.url).searchParams;
    const job = await jobStatus(parseProvider(params.get("provider")), params.get("id") ?? "");
    return NextResponse.json(job);
  } catch (e) {
    return errorResponse(e);
  }
}

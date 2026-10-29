import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { usageReport } from "@/lib/usage";

// Settings -> Storage. ?summary=1 returns only the Supabase numbers.
export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const summary = new URL(req.url).searchParams.has("summary");
    return NextResponse.json(await usageReport({ full: !summary }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

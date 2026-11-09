import { NextResponse } from "next/server";
import { getSpendingStats } from "@/lib/db";
import { errorResponse, requireSession } from "@/lib/server";

// Settings -> Spending. `stats` is null until spending_stats() is installed.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    return NextResponse.json({ stats: await getSpendingStats(), checkedAt: Date.now() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

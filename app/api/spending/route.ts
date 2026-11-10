import { NextResponse } from "next/server";
import { getSpendingStats } from "@/lib/db";
import { getPikaBalance, getPikaSpend, type PikaBalance } from "@/lib/providers/pika";
import { errorResponse, requireSession } from "@/lib/server";

// Settings -> Spending. `stats` is null until spending_stats() is installed.
// `pika` is the account's money left and Pika's own record of this month's
// spend; both are read-only lookups that cost nothing. A Pika problem is
// reported in `pika.error` without failing the rest.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const [stats, pika] = await Promise.all([
      getSpendingStats(),
      Promise.all([getPikaBalance(), getPikaSpend(monthStart, today)])
        .then(([balance, spentThisMonthUsd]): { balance?: PikaBalance; spentThisMonthUsd?: number; error?: string } => ({ balance, spentThisMonthUsd }))
        .catch((e: Error) => ({ error: e.message })),
    ]);
    return NextResponse.json({ stats, pika, checkedAt: Date.now() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

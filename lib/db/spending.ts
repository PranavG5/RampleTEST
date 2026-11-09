import "server-only";
import { adminClient } from "./client";

// Raw numbers from the spending_stats() database function (Settings -> Spending).
// exact: charges Pika confirmed. estimated: Pika's quote at Generate for finished
// runs without a confirmed charge. unpriced: finished runs with neither.
export interface SpendBucket {
  exact: number;
  estimated: number;
  runs: number;
  unpriced: number;
}

export interface SpendingStats {
  totals: { total: SpendBucket; this_month: SpendBucket; last_30_days: SpendBucket; deleted: SpendBucket };
  by_provider: (SpendBucket & { provider: string })[];
  by_model: { provider: string; model: string; exact: number; estimated: number; runs: number }[];
  by_month: { month: string; exact: number; estimated: number; runs: number }[];
}

// Returns null when the function isn't installed yet (migration not run).
export async function getSpendingStats(): Promise<SpendingStats | null> {
  const { data, error } = await adminClient().rpc("spending_stats");
  if (error) {
    if (error.code === "PGRST202") return null;
    throw new Error(`Couldn't read spending: ${error.message}`);
  }
  return data as SpendingStats;
}

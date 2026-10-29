import "server-only";
import { adminClient } from "./client";

// Raw numbers from the usage_stats() database function (Settings -> Storage).
export interface UsageStats {
  database_bytes: number;
  tables: { name: string; rows: number; bytes: number }[];
  buckets: { bucket: string; public: boolean; size_limit: number | null; files: number; bytes: number }[];
  videos: {
    visible: { files: number; bytes: number };
    hidden_soft_deleted: { files: number; bytes: number };
    without_run: { files: number; bytes: number };
    by_model: { provider: string; model: string; files: number; bytes: number }[];
  };
  runs: { total: number; with_saved_video: number; video_not_saved: number };
}

// Returns null when the function isn't installed yet (migration not run).
export async function getUsageStats(): Promise<UsageStats | null> {
  const { data, error } = await adminClient().rpc("usage_stats");
  if (error) {
    if (error.code === "PGRST202") return null;
    throw new Error(`Couldn't read storage usage: ${error.message}`);
  }
  return data as UsageStats;
}

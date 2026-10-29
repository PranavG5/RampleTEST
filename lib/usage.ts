import "server-only";
import { list } from "@vercel/blob";
import { getUsageStats, type UsageStats } from "./db";
import { planQuotas, supabaseUrl } from "./db/env";

// Everything Settings -> Storage shows, gathered on the server. Read-only.

export interface BlobUsage {
  configured: boolean;
  files: number;
  bytes: number;
  truncated: boolean; // stopped counting after MAX_BLOB_PAGES pages
  error?: string;
}

export interface UsageReport {
  supabase: UsageStats | null; // null: usage_stats() not installed yet
  quotas: { storageBytes: number; databaseBytes: number };
  blob?: BlobUsage;
  dashboardUrl: string | null;
  checkedAt: number;
}

const MAX_BLOB_PAGES = 10;

// Pika input uploads live in the Vercel Blob store, outside Supabase.
async function blobUsage(): Promise<BlobUsage> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { configured: false, files: 0, bytes: 0, truncated: false };
  let files = 0;
  let bytes = 0;
  let cursor: string | undefined;
  try {
    for (let page = 0; page < MAX_BLOB_PAGES; page++) {
      const res = await list({ token, cursor, limit: 1000 });
      files += res.blobs.length;
      bytes += res.blobs.reduce((n, b) => n + b.size, 0);
      if (!res.hasMore) return { configured: true, files, bytes, truncated: false };
      cursor = res.cursor;
    }
    return { configured: true, files, bytes, truncated: true };
  } catch (e) {
    return { configured: true, files, bytes, truncated: false, error: (e as Error).message };
  }
}

function dashboardUrl(): string | null {
  const host = new URL(supabaseUrl()).hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  return host ? `https://supabase.com/dashboard/project/${host[1]}/settings/billing/usage` : null;
}

// `full: false` skips the Vercel Blob count (used for the header's quiet warning dot).
export async function usageReport({ full }: { full: boolean }): Promise<UsageReport> {
  const [supabase, blob] = await Promise.all([getUsageStats(), full ? blobUsage() : Promise.resolve(undefined)]);
  return { supabase, quotas: planQuotas(), blob, dashboardUrl: dashboardUrl(), checkedAt: Date.now() };
}

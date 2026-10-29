// Browser cache for stored videos (Cache API). A video is cached the first time
// someone plays it, then plays from this machine on later views without a new
// download. Capped at about 1 GB; least recently watched videos go first.

const CACHE = "rample-videos-v1";
const INDEX_KEY = "rample-model-lab:video-cache:v1";
const MAX_BYTES = 1024 * 1024 * 1024;

type Index = Record<string, { bytes: number; at: number }>;

// Cache keys are stable per run; signed URLs change every time.
const keyFor = (runId: string) => `/__video-cache/${runId}`;

function available(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

function readIndex(): Index {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "{}") as Index;
  } catch {
    return {};
  }
}

function writeIndex(idx: Index): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch {}
}

// Object URL for a cached video, or null. The caller revokes it.
export async function cachedVideoUrl(runId: string): Promise<string | null> {
  if (!available()) return null;
  try {
    const res = await (await caches.open(CACHE)).match(keyFor(runId));
    if (!res) return null;
    const idx = readIndex();
    if (idx[runId]) {
      idx[runId].at = Date.now();
      writeIndex(idx);
    }
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

const inFlight = new Set<string>();

// Downloads the video from a signed URL and keeps it. Best effort: any failure
// just means the next view streams from Storage again.
export async function cacheVideo(runId: string, url: string): Promise<void> {
  if (!available() || inFlight.has(runId)) return;
  inFlight.add(runId);
  try {
    const cache = await caches.open(CACHE);
    if (await cache.match(keyFor(runId))) return;
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob.size || blob.size > MAX_BYTES / 4) return;
    await cache.put(keyFor(runId), new Response(blob, { headers: { "Content-Type": blob.type || "video/mp4" } }));
    const idx = readIndex();
    idx[runId] = { bytes: blob.size, at: Date.now() };
    let total = Object.values(idx).reduce((n, e) => n + e.bytes, 0);
    for (const [id, e] of Object.entries(idx).sort((a, b) => a[1].at - b[1].at)) {
      if (total <= MAX_BYTES) break;
      await cache.delete(keyFor(id));
      total -= e.bytes;
      delete idx[id];
    }
    writeIndex(idx);
  } catch {
    // Quota or network trouble; skip caching.
  } finally {
    inFlight.delete(runId);
  }
}

// How much this browser's video cache holds (for Settings -> Storage).
export function videoCacheUsage(): { files: number; bytes: number; maxBytes: number } {
  const entries = Object.values(readIndex());
  return { files: entries.length, bytes: entries.reduce((n, e) => n + e.bytes, 0), maxBytes: MAX_BYTES };
}

export async function removeCachedVideo(runId: string): Promise<void> {
  try {
    if (available()) await (await caches.open(CACHE)).delete(keyFor(runId));
    const idx = readIndex();
    delete idx[runId];
    writeIndex(idx);
  } catch {}
}

export async function clearVideoCache(): Promise<void> {
  try {
    if (available()) await caches.delete(CACHE);
    localStorage.removeItem(INDEX_KEY);
  } catch {}
}

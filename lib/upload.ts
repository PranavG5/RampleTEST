// Browser-side upload of an image/video so the selected provider can read it.
//
// Higgsfield: presigned URL straight to Higgsfield's storage (allows browser uploads).
// Pika: Pika's storage only accepts browser uploads from dev.pika.art, so the file
// goes to this project's Vercel Blob store instead and Pika gets that public URL.
// Either way, a small file can fall back to going through our server (4 MB cap).
import { upload as blobUpload } from "@vercel/blob/client";
import type { Provider } from "./types";
import type { Asset } from "./extract";

const LIMITS: Record<Provider, { image: number; video: number }> = {
  pika: { image: 20 * 1024 * 1024, video: 50 * 1024 * 1024 },
  higgsfield: { image: Infinity, video: Infinity }, // no published limit; Higgsfield rejects oversize files itself
};

const PROXY_MAX = 4 * 1024 * 1024;

// Headers the browser sets itself and refuses to let scripts set.
const FORBIDDEN = new Set(["content-length", "host", "connection"]);

async function apiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error ?? `Request failed (${res.status})`;
}

async function viaServer(asset: Asset, provider: Provider, why: string): Promise<string> {
  if (asset.size > PROXY_MAX) {
    throw new Error(`${asset.name}: ${why}. Files over 4 MB can't use the server fallback.`);
  }
  const res = await fetch(`/api/upload/proxy?provider=${provider}`, {
    method: "POST",
    headers: { "Content-Type": asset.type },
    body: asset.file,
  });
  if (!res.ok) throw new Error(`${asset.name}: ${why}, and the server fallback failed: ${await apiError(res)}`);
  return ((await res.json()) as { publicUrl: string }).publicUrl;
}

let blobConfigured: Promise<boolean> | null = null;
function hasBlobStore(): Promise<boolean> {
  blobConfigured ??= fetch("/api/upload/blob")
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((b: { configured?: boolean }) => !!b.configured)
    .catch(() => false);
  return blobConfigured;
}

// Returns null when no Blob store is connected, so the caller can fall back.
async function toBlobStore(asset: Asset): Promise<string | null> {
  if (!(await hasBlobStore())) return null;
  const safeName = asset.name.replace(/[^\w.-]+/g, "_").slice(-80) || "input";
  try {
    const result = await blobUpload(`inputs/${safeName}`, asset.file, {
      access: "public",
      handleUploadUrl: "/api/upload/blob",
      contentType: asset.type,
      multipart: asset.size > 8 * 1024 * 1024,
    });
    return result.url;
  } catch (e) {
    throw new Error(`${asset.name}: upload to Vercel Blob failed: ${(e as Error).message}`);
  }
}

async function toProviderStorage(asset: Asset, provider: Provider): Promise<string> {
  const mint = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, contentType: asset.type, size: asset.size }),
  });
  if (!mint.ok) throw new Error(`${asset.name}: ${await apiError(mint)}`);
  const target = (await mint.json()) as { uploadUrl?: string; headers: Record<string, string>; publicUrl: string };
  if (!target.uploadUrl) return target.publicUrl;

  const headers = Object.fromEntries(Object.entries(target.headers).filter(([k]) => !FORBIDDEN.has(k.toLowerCase())));
  let direct: Response | null = null;
  try {
    direct = await fetch(target.uploadUrl, { method: "PUT", headers, body: asset.file });
  } catch {
    direct = null; // usually CORS
  }
  if (direct?.ok) return target.publicUrl;
  return viaServer(asset, provider, direct ? `storage returned ${direct.status}` : "the browser upload was blocked");
}

export async function uploadAsset(asset: Asset, provider: Provider): Promise<string> {
  const cached = asset.hosted[provider];
  if (cached) return cached;
  if (asset.kind !== "image" && asset.kind !== "video") throw new Error(`${asset.name} is not an image or video`);

  const limit = LIMITS[provider][asset.kind];
  if (asset.size > limit) {
    throw new Error(`${asset.name} is ${(asset.size / 1e6).toFixed(0)} MB; ${provider} allows ${(limit / 1e6).toFixed(0)} MB for ${asset.kind}s`);
  }

  let url: string;
  if (provider === "pika") {
    url =
      (await toBlobStore(asset)) ??
      (await viaServer(
        asset,
        provider,
        "Pika uploads over 4 MB need a Vercel Blob store (Vercel → Storage → Create → Blob, connect it to this project, then redeploy)",
      ));
  } else {
    url = await toProviderStorage(asset, provider);
  }
  asset.hosted[provider] = url;
  return url;
}

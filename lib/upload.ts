// Browser-side upload of an image/video to the selected provider's storage.
import type { Provider } from "./types";
import type { Asset } from "./extract";

const LIMITS: Record<Provider, { image: number; video: number }> = {
  pika: { image: 20 * 1024 * 1024, video: 50 * 1024 * 1024 },
  higgsfield: { image: Infinity, video: Infinity }, // no published limit; Higgsfield rejects oversize files itself
};

// Headers the browser sets itself and refuses to let scripts set.
const FORBIDDEN = new Set(["content-length", "host", "connection"]);

async function apiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error ?? `Request failed (${res.status})`;
}

export async function uploadAsset(asset: Asset, provider: Provider): Promise<string> {
  const cached = asset.hosted[provider];
  if (cached) return cached;
  if (asset.kind !== "image" && asset.kind !== "video") throw new Error(`${asset.name} is not an image or video`);

  const limit = LIMITS[provider][asset.kind];
  if (asset.size > limit) {
    throw new Error(`${asset.name} is ${(asset.size / 1e6).toFixed(0)} MB; ${provider} allows ${(limit / 1e6).toFixed(0)} MB for ${asset.kind}s`);
  }

  const mint = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, contentType: asset.type, size: asset.size }),
  });
  if (!mint.ok) throw new Error(`${asset.name}: ${await apiError(mint)}`);
  const target = (await mint.json()) as { uploadUrl?: string; headers: Record<string, string>; publicUrl: string };

  if (target.uploadUrl) {
    const headers = Object.fromEntries(Object.entries(target.headers).filter(([k]) => !FORBIDDEN.has(k.toLowerCase())));
    let direct: Response | null = null;
    try {
      direct = await fetch(target.uploadUrl, { method: "PUT", headers, body: asset.file });
    } catch {
      direct = null; // usually CORS; fall through to the server proxy
    }
    if (!direct || !direct.ok) {
      const viaServer = await fetch(`/api/upload/proxy?provider=${provider}`, {
        method: "POST",
        headers: { "Content-Type": asset.type },
        body: asset.file,
      });
      if (!viaServer.ok) {
        const why = direct ? `storage returned ${direct.status}` : "the browser upload was blocked";
        throw new Error(`${asset.name}: ${why}, and the server fallback failed: ${await apiError(viaServer)}`);
      }
      const { publicUrl } = (await viaServer.json()) as { publicUrl: string };
      asset.hosted[provider] = publicUrl;
      return publicUrl;
    }
  }
  asset.hosted[provider] = target.publicUrl;
  return target.publicUrl;
}

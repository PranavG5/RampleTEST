import { NextResponse } from "next/server";
import { ProviderError, errorResponse, requireSession } from "@/lib/server";
import { parseProvider, uploadTarget } from "@/lib/providers";

// Fallback when the browser can't PUT to the provider's storage directly
// (for example a CORS block). Vercel caps request bodies at about 4.5 MB,
// so this only works for small files.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const provider = parseProvider(new URL(req.url).searchParams.get("provider"));
    const contentType = req.headers.get("content-type") ?? "application/octet-stream";
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      throw new ProviderError(413, "File is too large for the server upload fallback (4 MB max).");
    }
    const target = await uploadTarget(provider, contentType, bytes.byteLength);
    if (target.uploadUrl) {
      // fetch sets Content-Length itself from the body; passing it again can be rejected.
      const headers = Object.fromEntries(
        Object.entries(target.headers).filter(([k]) => !["content-length", "host"].includes(k.toLowerCase())),
      );
      const put = await fetch(target.uploadUrl, { method: "PUT", headers, body: bytes });
      if (!put.ok) throw new ProviderError(502, `Storage rejected the upload (${put.status})`);
    }
    return NextResponse.json({ publicUrl: target.publicUrl });
  } catch (e) {
    return errorResponse(e);
  }
}

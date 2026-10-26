import { NextResponse } from "next/server";
import { getRun, signedVideoUrl, SIGNED_URL_TTL_S } from "@/lib/db";
import { errorResponse, ProviderError, requireSession } from "@/lib/server";

// Short-lived signed URL for a stored video. ?redirect=1 sends the browser
// straight to it (used by "Open / download"); ?download=1 also asks for a download.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const run = await getRun((await params).id);
    if (!run) throw new ProviderError(404, "Run not found");
    if (!run.videoPath) throw new ProviderError(404, "This video isn't saved to storage yet");
    const q = new URL(req.url).searchParams;
    const name = `${run.modelName.replace(/[^\w.-]+/g, "_").slice(0, 60)}-${run.id.slice(0, 8)}.${run.videoPath.split(".").pop()}`;
    const url = await signedVideoUrl(run.videoPath, q.has("download") ? { download: name } : {});
    if (q.has("redirect")) return NextResponse.redirect(url);
    return NextResponse.json({ url, expiresIn: SIGNED_URL_TTL_S }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

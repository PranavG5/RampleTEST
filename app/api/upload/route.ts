import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { parseProvider, uploadTarget } from "@/lib/providers";

// Step 1 of an upload: get a presigned URL from the provider. The browser then
// PUTs the file straight to storage, so big videos never pass through Vercel.
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const body = (await req.json()) as { provider?: string; contentType?: string; size?: number };
    const target = await uploadTarget(parseProvider(body.provider), body.contentType ?? "", Number(body.size ?? 0));
    return NextResponse.json(target);
  } catch (e) {
    return errorResponse(e);
  }
}

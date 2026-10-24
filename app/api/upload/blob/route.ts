import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server";

// Browser uploads to Vercel Blob, used for Pika inputs: Pika's own storage only
// accepts browser uploads from dev.pika.art, but Pika takes any public URL, so
// the file is hosted here instead.

// Lets the browser check whether a Blob store is connected before uploading.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  return NextResponse.json({ configured: !!process.env.BLOB_READ_WRITE_TOKEN });
}

// Issues a short-lived token so the browser can upload straight to Blob.
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Vercel Blob isn't connected to this project", code: "blob_not_configured" },
      { status: 501 },
    );
  }
  try {
    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/*", "video/*"],
        maximumSizeInBytes: 200 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

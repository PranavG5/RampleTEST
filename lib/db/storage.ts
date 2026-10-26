import "server-only";
import { adminClient, userClient } from "./client";
import { secretKey, supabaseUrl, VIDEO_BUCKET } from "./env";

// Videos live in a private bucket. Uploads run on the server with the secret key;
// reads go through short-lived signed URLs minted for the signed-in user (RLS).

export const SIGNED_URL_TTL_S = 10 * 60;

// Supabase recommends resumable (TUS) uploads above 6 MB, in 6 MB chunks.
const RESUMABLE_ABOVE = 6 * 1024 * 1024;
const TUS_CHUNK = 6 * 1024 * 1024;

export async function uploadVideo(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (bytes.byteLength > RESUMABLE_ABOVE) return resumableUpload(path, bytes, contentType);
  const { error } = await adminClient().storage.from(VIDEO_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

// Large uploads go to the direct storage host (<ref>.storage.supabase.co), as Supabase advises.
function resumableEndpoint(): string {
  const base = supabaseUrl();
  const host = new URL(base).hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  return host ? `https://${host[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${base}/storage/v1/upload/resumable`;
}

async function resumableUpload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { Upload } = await import("tus-js-client");
  const key = secretKey();
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      endpoint: resumableEndpoint(),
      // Each chunk is retried on network errors, resuming from the last stored byte.
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${key}`, apikey: key, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK,
      metadata: { bucketName: VIDEO_BUCKET, objectName: path, contentType, cacheControl: "3600" },
      onError: (e) => reject(new Error(`Resumable upload failed: ${e.message}`)),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export async function signedVideoUrl(path: string, opts: { download?: string } = {}): Promise<string> {
  const supabase = await userClient();
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S, opts.download ? { download: opts.download } : undefined);
  if (error || !data?.signedUrl) throw new Error(`Couldn't create a video link: ${error?.message ?? "no URL returned"}`);
  return data.signedUrl;
}

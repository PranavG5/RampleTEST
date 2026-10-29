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

// Removes every file stored for a run (runs/{id}/...) and checks the folder is
// empty afterwards, retrying a few times. Returns false if files remain.
export async function removeRunVideos(runId: string, knownPath: string | null): Promise<boolean> {
  const bucket = adminClient().storage.from(VIDEO_BUCKET);
  const folder = `runs/${runId}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: listed, error: listError } = await bucket.list(folder);
    const paths = new Set(knownPath ? [knownPath] : []);
    for (const f of listed ?? []) paths.add(`${folder}/${f.name}`);
    const { error: removeError } = paths.size ? await bucket.remove([...paths]) : { error: null };
    const { data: left, error: checkError } = await bucket.list(folder);
    const problem = listError ?? removeError ?? checkError;
    if (!problem && !left?.length) return true;
    console.error(`Removing videos for run ${runId} failed (attempt ${attempt}):`, problem?.message ?? `${left?.length} file(s) left`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return false;
}

export async function signedVideoUrl(path: string, opts: { download?: string } = {}): Promise<string> {
  const supabase = await userClient();
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S, opts.download ? { download: opts.download } : undefined);
  if (error || !data?.signedUrl) throw new Error(`Couldn't create a video link: ${error?.message ?? "no URL returned"}`);
  return data.signedUrl;
}

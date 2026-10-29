// Supabase settings. All three stay on the server: the browser only talks to
// this app's API routes (and to Storage through short-lived signed URLs).

export const VIDEO_BUCKET = "videos";

// Only the server reads the session, so the auth cookies are hidden from page scripts.
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. Add it in the Vercel project settings (see .env.example).`);
  return v;
}

export function supabaseUrl(): string {
  return required("SUPABASE_URL").replace(/\/+$/, "");
}

// Publishable key (sb_publishable_...) or the legacy anon key. Low privilege:
// every request made with it is limited by RLS to what the signed-in user can see.
export function publishableKey(): string {
  return process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || required("SUPABASE_ANON_KEY");
}

// Secret key (sb_secret_...) or the legacy service_role key. Bypasses RLS, so it is
// only used by the background job that copies finished videos into Storage.
export function secretKey(): string {
  return process.env.SUPABASE_SECRET_KEY?.trim() || required("SUPABASE_SERVICE_ROLE_KEY");
}

// Plan quotas shown in Settings -> Storage. Free plan: 1 GB file storage and
// 500 MB database. On Pro set SUPABASE_STORAGE_QUOTA_GB=100, SUPABASE_DATABASE_QUOTA_MB=8192.
export function planQuotas(): { storageBytes: number; databaseBytes: number } {
  const num = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    storageBytes: num("SUPABASE_STORAGE_QUOTA_GB", 1) * 1024 ** 3,
    databaseBytes: num("SUPABASE_DATABASE_QUOTA_MB", 500) * 1024 ** 2,
  };
}

// Largest video the bucket accepts. The Free plan caps every file at 50 MB.
export function videoMaxBytes(): number {
  const mb = Number(process.env.VIDEO_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024;
}

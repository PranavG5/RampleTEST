// Single hardcoded test account. The session cookie is an HMAC-signed
// "email.expiry" string, so it can't be forged without the signing secret.

export const TEST_EMAIL = "test@rample.ai";
export const TEST_PASSWORD = "baxatest";
export const SESSION_COOKIE = "rample_session";
const SESSION_DAYS = 14;

// AUTH_SECRET is optional. Without it, the cookie is signed with the provider
// API keys, which are already server-only secrets. Changing a key just signs
// everyone out once.
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  const fromKeys = [
    process.env.PIKA_API_KEY,
    process.env.HIGGSFIELD_API_KEY,
    process.env.HIGGSFIELD_API_KEY_SECRET,
    process.env.ANTHROPIC_API_KEY,
  ]
    .filter(Boolean)
    .join("|");
  if (fromKeys.length >= 16) return `rample-session|${fromKeys}`;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    // Fail closed on Vercel so a missing secret never ships a forgeable cookie.
    throw new Error("No API keys are set on Vercel yet. Add PIKA_API_KEY, HIGGSFIELD_API_KEY and ANTHROPIC_API_KEY.");
  }
  return "local-dev-only-secret-change-me";
}

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(sig).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkCredentials(email: string, password: string): boolean {
  return safeEqual(email.trim().toLowerCase(), TEST_EMAIL) && safeEqual(password, TEST_PASSWORD);
}

export async function createSessionToken(): Promise<{ token: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `${Buffer.from(TEST_EMAIL).toString("base64url")}.${exp}`;
  return { token: `${payload}.${await hmac(payload)}`, maxAge };
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(`${user}.${exp}`));
}

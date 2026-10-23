import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

export class ProviderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Second check on top of proxy.ts, so an API route is never reachable without a session.
export async function requireSession(): Promise<NextResponse | null> {
  const jar = await cookies();
  if (await verifySessionToken(jar.get(SESSION_COOKIE)?.value)) return null;
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ProviderError) {
    // A provider's 401/403 means a bad API key, not that the tester is signed out,
    // so don't pass it through (the UI treats 401 as "go to login").
    const status = e.status === 401 || e.status === 403 ? 502 : e.status >= 400 && e.status < 600 ? e.status : 502;
    return NextResponse.json({ error: e.message }, { status });
  }
  console.error(e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
}

// Pulls a readable message out of the many error shapes the providers return.
export function extractError(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === "string") return body.slice(0, 500) || fallback;
  if (typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.detail)) {
    return b.detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const loc = Array.isArray(d.loc) ? d.loc.filter((x) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  if (typeof b.detail === "string") return b.detail;
  if (typeof b.message === "string") return b.message;
  if (b.error && typeof b.error === "object") {
    const err = b.error as Record<string, unknown>;
    const code = typeof err.code === "string" ? ` (${err.code})` : "";
    if (typeof err.message === "string") return err.message + code;
  }
  if (typeof b.error === "string") return b.error;
  return fallback;
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v) throw new ProviderError(500, `${name} is not set. ${hint}`);
  return v;
}

// Model ids are path segments like "pika/pika-2.5/text-to-video". Keep them tight
// so a crafted id can't walk to other API paths.
export function isSafeModelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,5}$/i.test(id) && !id.includes("..");
}

import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkCredentials, createSessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!checkCredentials(body.email ?? "", body.password ?? "")) {
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  let session: { token: string; maxAge: number };
  try {
    session = await createSessionToken();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const { token, maxAge } = session;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}

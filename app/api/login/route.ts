import { NextResponse } from "next/server";
import { signIn } from "@/lib/db";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  }
  try {
    const { error } = await signIn(body.email, body.password);
    if (error) return NextResponse.json({ error }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

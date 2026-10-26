import { NextResponse } from "next/server";
import { signOut } from "@/lib/db";

export async function POST() {
  await signOut().catch((e) => console.error("Sign out failed:", e));
  return NextResponse.json({ ok: true });
}

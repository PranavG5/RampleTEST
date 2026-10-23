import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { listModels, parseProvider } from "@/lib/providers";

export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const provider = parseProvider(new URL(req.url).searchParams.get("provider"));
    return NextResponse.json({ models: await listModels(provider) });
  } catch (e) {
    return errorResponse(e);
  }
}

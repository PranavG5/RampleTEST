import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";
import { getModel, parseProvider } from "@/lib/providers";

export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const params = new URL(req.url).searchParams;
    const provider = parseProvider(params.get("provider"));
    return NextResponse.json({ model: await getModel(provider, params.get("id") ?? "") });
  } catch (e) {
    return errorResponse(e);
  }
}

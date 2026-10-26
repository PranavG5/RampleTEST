import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/db/proxy";

// Everything except the login page, login API and static assets needs a
// Supabase session. This also refreshes an expiring session's cookies.
export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  if (userId) return response;

  const denied = request.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Not signed in" }, { status: 401 })
    : NextResponse.redirect(Object.assign(request.nextUrl.clone(), { pathname: "/login", search: "" }));
  // Carry over any cookie changes (for example clearing a dead session).
  for (const c of response.cookies.getAll()) denied.cookies.set(c);
  return denied;
}

export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

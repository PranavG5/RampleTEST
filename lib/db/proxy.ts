// Session refresh for proxy.ts. Kept apart from client.ts because the proxy
// works on the request/response cookies instead of next/headers.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS, publishableKey, supabaseUrl } from "./env";

export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request });
  let url: string, key: string;
  try {
    url = supabaseUrl();
    key = publishableKey();
  } catch {
    // Not configured yet: treat as signed out. The login form shows which variable is missing.
    return { response, userId: null };
  }
  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  // Verifies the JWT (and refreshes an expired one), so a forged cookie never passes.
  const { data } = await supabase.auth.getClaims();
  return { response, userId: data?.claims?.sub ?? null };
}

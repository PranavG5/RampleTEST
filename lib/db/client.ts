import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS, publishableKey, secretKey, supabaseUrl } from "./env";

// Acts as the signed-in user (session from the auth cookies), so RLS applies.
// Use this for everything a request does on someone's behalf.
export async function userClient(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(supabaseUrl(), publishableKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => jar.getAll(),
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // Called from a context that can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

// Full access, no RLS. Server-only, for the background video copy.
let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(supabaseUrl(), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}

import "server-only";
import { userClient } from "./client";

// Email/password sign-in through Supabase Auth. The session lands in httpOnly
// cookies set by the Supabase client; there are no credentials in this codebase.

export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const supabase = await userClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (!error) return { error: null };
  return { error: error.code === "invalid_credentials" ? "Wrong email or password" : error.message };
}

export async function signOut(): Promise<void> {
  const supabase = await userClient();
  await supabase.auth.signOut();
}

// The signed-in user's id, or null. Verifies the session JWT.
export async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await userClient();
    const { data } = await supabase.auth.getClaims();
    return data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}

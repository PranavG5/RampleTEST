#!/usr/bin/env node
// Creates (or resets the password of) the team's Supabase Auth account.
// Sign-ups are off, so this is the only way an account is made.
//
// Run: RAMPLE_USER_EMAIL=... RAMPLE_USER_PASSWORD=... npm run create-user
// Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment or .env.local.

import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.RAMPLE_USER_EMAIL?.trim().toLowerCase();
const password = process.env.RAMPLE_USER_PASSWORD;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (in .env.local or the environment).");
  process.exit(1);
}
if (!email || !password) {
  console.error("Set RAMPLE_USER_EMAIL and RAMPLE_USER_PASSWORD.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (!error) {
  console.log(`Created ${data.user.email} (${data.user.id}).`);
  process.exit(0);
}
if (error.code !== "email_exists") {
  console.error(`Couldn't create the user: ${error.message}`);
  process.exit(1);
}

// Already there: set the password so the login matches.
let user;
for (let page = 1; !user; page++) {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (listError) {
    console.error(`Couldn't look up the existing user: ${listError.message}`);
    process.exit(1);
  }
  user = list.users.find((u) => u.email === email);
  if (list.users.length < 200) break;
}
if (!user) {
  console.error(`Supabase says ${email} exists but it wasn't found in the user list.`);
  process.exit(1);
}
const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
if (updateError) {
  console.error(`Couldn't update the password: ${updateError.message}`);
  process.exit(1);
}
console.log(`${email} already existed; password updated.`);

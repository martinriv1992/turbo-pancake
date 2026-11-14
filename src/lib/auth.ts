import bcrypt from "bcryptjs";
import { sql } from "./db";

// Credential verification is pluggable; the session (src/lib/session.ts) is always ours.
//  - local:    users live in auth.users with bcrypt hashes (works on plain PostgreSQL).
//  - supabase: Supabase Auth verifies credentials. Written against supabase-js v2 but NOT
//              yet exercised against a live project.
export type AuthResult = { ok: true; userId: string; email: string } | { ok: false; error: string };

const driver = () => (process.env.AUTH_DRIVER === "supabase" ? "supabase" : "local");

async function supabaseClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for AUTH_DRIVER=supabase");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureProfile(userId: string, email: string, fullName?: string) {
  await sql`
    insert into profiles (id, email, full_name) values (${userId}, ${email}, ${fullName ?? null})
    on conflict (id) do update set email = excluded.email,
      full_name = coalesce(excluded.full_name, profiles.full_name)`;
}

export async function signUp(emailRaw: string, password: string, fullName: string): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  if (driver() === "supabase") {
    const { data, error } = await (await supabaseClient()).auth.signUp({ email, password });
    if (error || !data.user) return { ok: false, error: error?.message ?? "Sign-up failed." };
    await ensureProfile(data.user.id, email, fullName);
    return { ok: true, userId: data.user.id, email };
  }

  const existing = await sql`select 1 from auth.users where email = ${email}`;
  if (existing.length) return { ok: false, error: "An account with this email already exists." };
  const hash = await bcrypt.hash(password, 10);
  const [user] = await sql`insert into auth.users (email, encrypted_password) values (${email}, ${hash}) returning id`;
  await ensureProfile(user.id, email, fullName);
  return { ok: true, userId: user.id, email };
}

export async function signIn(emailRaw: string, password: string): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  if (driver() === "supabase") {
    const { data, error } = await (await supabaseClient()).auth.signInWithPassword({ email, password });
    if (error || !data.user) return { ok: false, error: "Incorrect email or password." };
    await ensureProfile(data.user.id, email);
    return { ok: true, userId: data.user.id, email };
  }
  const [user] = await sql`select id, encrypted_password from auth.users where email = ${email}`;
  if (!user?.encrypted_password || !(await bcrypt.compare(password, user.encrypted_password))) {
    return { ok: false, error: "Incorrect email or password." };
  }
  await ensureProfile(user.id, email);
  return { ok: true, userId: user.id, email };
}

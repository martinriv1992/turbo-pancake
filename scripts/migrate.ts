// Applies supabase/migrations/*.sql in order, tracking what ran in app_migrations.
// (On a hosted Supabase project you can use `supabase db push` instead.)
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://ucs_app:ucs_local_dev@127.0.0.1:5432/ucs";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = path.join(process.cwd(), "supabase", "migrations");

await sql`create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now())`;
await sql`alter table public.app_migrations enable row level security`;
const done = new Set((await sql`select name from public.app_migrations`).map((r) => r.name));
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    await tx`insert into public.app_migrations (name) values (${file})`;
  });
  console.log("applied", file);
}
await sql.end();

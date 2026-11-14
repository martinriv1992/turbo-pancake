import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://ucs_app:ucs_local_dev@127.0.0.1:5432/ucs";

type Db = postgres.Sql<Record<string, never>>;
const g = globalThis as unknown as { __ucsSql?: Db };

/** Service connection: bypasses RLS. Use only in workers and auth; scope every query explicitly. */
export const sql: Db = (g.__ucsSql ??= postgres(url, { max: 10, onnotice: () => {} }));

/**
 * Runs `fn` in a transaction as the given user with Row Level Security enforced —
 * the same mechanism Supabase uses (role `authenticated` + request.jwt.claims).
 * All request-path data access goes through this.
 */
export async function asUser<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`set local role authenticated`;
    return fn(tx as unknown as Db);
  }) as Promise<T>;
}

export type { Db };

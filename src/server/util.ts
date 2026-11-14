import { redirect } from "next/navigation";
import type { Db } from "@/lib/db";

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const opt = (f: FormData, k: string) => str(f, k) || null;
export const lines = (f: FormData, k: string) => str(f, k).split(/\n|;/).map((s) => s.trim()).filter(Boolean);
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

const withParam = (path: string, key: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;
/** Redirect back with an error banner. Never returns. */
export const fail = (path: string, msg: string): never => redirect(withParam(path, "error", msg));
export const done = (path: string, msg: string): never => redirect(withParam(path, "ok", msg));

/** Turns database errors into messages a person can act on. */
export function dbMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err.code === "42501") return "You do not have permission to do that.";
  if (err.code === "23505") return "That already exists.";
  if (err.code === "23503") return "That refers to something that no longer exists or belongs elsewhere.";
  if (err.code === "P0001") return err.message ?? "Not allowed.";
  return err.message ?? "Something went wrong.";
}

export async function audit(tx: Db, a: { orgId: string; workspaceId?: string | null; userId: string; action: string; entityType?: string; entityId?: string; detail?: object }) {
  await tx`insert into audit_logs (org_id, workspace_id, actor_id, action, entity_type, entity_id, detail)
           values (${a.orgId}, ${a.workspaceId ?? null}, ${a.userId}, ${a.action}, ${a.entityType ?? null}, ${a.entityId ?? null}, ${tx.json((a.detail ?? {}) as never)})`;
}

/** Next.js signals redirects by throwing; let those through when catching action errors. */
export const isRedirect = (e: unknown) => String((e as { digest?: string })?.digest ?? "").startsWith("NEXT_REDIRECT");

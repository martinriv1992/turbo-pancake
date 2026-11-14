import { asUser } from "@/lib/db";
import { readSession } from "@/lib/session";
import { storage } from "@/lib/storage";

// Serves a stored file only if the signed-in user can see a row that references it.
// Row Level Security does the authorization: the lookup runs as the user.
export async function GET(req: Request) {
  const session = await readSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";

  const [hit] = await asUser(session.userId, (tx) => tx`
    select mime_type, title from content_assets where storage_path = ${path}
    union all select mime_type, title from brand_assets where storage_path = ${path}
    union all select null, 'version' from versions where storage_path = ${path}
    limit 1`);
  if (!hit) return new Response("Not found", { status: 404 });

  const data = await storage.get(path);
  if (!data) return new Response("Not found", { status: 404 });
  const ext = path.split(".").pop() ?? "bin";
  const mime = hit.mime_type ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Length": String(data.length),
    "Cache-Control": "private, max-age=300",
    // Uploaded and generated files are never executed in the app's origin.
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "X-Content-Type-Options": "nosniff",
  };
  if (url.searchParams.get("download")) {
    const name = String(hit.title).replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
    headers["Content-Disposition"] = `attachment; filename="${name}.${ext}"`;
  }
  return new Response(new Uint8Array(data), { headers });
}

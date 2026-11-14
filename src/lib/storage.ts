import fs from "node:fs/promises";
import path from "node:path";

// Object storage behind one interface. Keys are tenant-prefixed:
//   org/<org>/brand/<brand>/jobs/<job>/<file>
// Access control is NOT done here: the file route checks the key against RLS-protected rows.
export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const safe = (key: string) => {
  const clean = path.posix.normalize(key);
  if (clean.startsWith("..") || path.posix.isAbsolute(clean)) throw new Error("Invalid storage key");
  return clean;
};

function localStorage(): Storage {
  const root = path.resolve(process.env.STORAGE_DIR || "./storage");
  return {
    async put(key, data) {
      const file = path.join(root, safe(key));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    },
    async get(key) {
      try {
        return await fs.readFile(path.join(root, safe(key)));
      } catch {
        return null;
      }
    },
  };
}

// Supabase Storage (private bucket, service-role access). NOT yet exercised against a live project.
function supabaseStorage(): Storage {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "ucs-assets";
  const client = async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for STORAGE_DRIVER=supabase");
    return createClient(url, key, { auth: { persistSession: false } });
  };
  return {
    async put(key, data, mime) {
      const { error } = await (await client()).storage.from(bucket).upload(safe(key), data, { contentType: mime, upsert: true });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await (await client()).storage.from(bucket).download(safe(key));
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

export const storage: Storage = process.env.STORAGE_DRIVER === "supabase" ? supabaseStorage() : localStorage();

export const jobKey = (j: { org_id: string; brand_id: string; id: string }, file: string) =>
  `org/${j.org_id}/brand/${j.brand_id}/jobs/${j.id}/${file}`;
export const brandKey = (b: { org_id: string; id: string }, file: string) => `org/${b.org_id}/brand/${b.id}/assets/${file}`;

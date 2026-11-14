// PostgreSQL-backed job queue. Jobs are claimed with FOR UPDATE SKIP LOCKED, so any number
// of workers can run side by side. Runs inside the Next.js server (instrumentation.ts) or
// standalone via `npm run worker`.
import os from "node:os";
import { sql } from "@/lib/db";
import { runJob } from "./pipeline";

const workerId = `${os.hostname()}:${process.pid}`;
const STALE_MINUTES = 15;

async function claim(): Promise<string | null> {
  const rows = await sql`
    update content_jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    where id = (
      select j.id from content_jobs j join organizations o on o.id = j.org_id
      where j.status = 'queued' and j.run_after <= now() and not o.emergency_stop
      order by j.created_at
      for update of j skip locked
      limit 1)
    returning id`;
  return rows[0]?.id ?? null;
}

/** Jobs whose worker died mid-run go back to the queue (or fail once attempts are used up). */
async function recoverStale() {
  await sql`
    update content_jobs set
      status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      locked_at = null, locked_by = null,
      errors = errors || ${sql.json({ at: new Date().toISOString(), message: "Worker stopped responding; job was recovered." })}::jsonb
    where status = 'running' and locked_at < now() - ${STALE_MINUTES} * interval '1 minute'`;
}

/** Scheduled manual publications become due: flag them for a person to publish. Nothing is
 *  ever marked published here — that needs a confirmed result. */
async function releaseDuePublications() {
  await sql`
    update publication_jobs set status = 'ready_manual',
      log = log || ${sql.json({ at: new Date().toISOString(), event: "due", detail: "Scheduled time reached. Waiting for manual publication." })}::jsonb
    where status = 'scheduled' and mode = 'manual_package' and scheduled_at <= now()`;
}

export async function tick(): Promise<boolean> {
  const id = await claim();
  if (!id) return false;
  try {
    await runJob(id);
  } catch (e) {
    // runJob handles its own failures; this is the last line of defence.
    await sql`update content_jobs set status = 'failed', locked_at = null, locked_by = null,
                errors = errors || ${sql.json({ at: new Date().toISOString(), message: `Worker error: ${(e as Error).message}` })}::jsonb
              where id = ${id}`;
  }
  return true;
}

const g = globalThis as unknown as { __ucsWorker?: boolean };

export function startWorker(pollMs = 1500) {
  if (g.__ucsWorker) return;
  g.__ucsWorker = true;
  let lastHousekeeping = 0;
  const loop = async () => {
    try {
      if (Date.now() - lastHousekeeping > 30_000) {
        lastHousekeeping = Date.now();
        await recoverStale();
        await releaseDuePublications();
      }
      while (await tick()) {
        /* drain the queue */
      }
    } catch (e) {
      console.error("[worker]", (e as Error).message);
    }
    setTimeout(loop, pollMs);
  };
  void loop();
  console.log(`[worker] started (${workerId})`);
}

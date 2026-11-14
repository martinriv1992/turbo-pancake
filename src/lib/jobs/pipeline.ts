// The production pipeline. Runs with the service connection (RLS bypassed), so every
// statement is scoped by the job's own org / workspace / brand.
import { sql, type Db } from "@/lib/db";
import { loadBrandContext, loadProviders } from "@/lib/brand-context";
import { candidates, estimateCall, unavailableReason, type RoutingPreference } from "@/lib/ai/registry";
import {
  costOf, RetryableProviderError,
  type BrandContext, type Brief, type Capability, type Concept, type ProviderRequest, type ProviderResult,
  type ProviderRow, type Scene, type TextTask,
} from "@/lib/ai/types";
import { contentType, FORMATS, type ContentType } from "@/lib/content/catalog";
import { jobKey, storage } from "@/lib/storage";
import { assertWithinBudget, BudgetError } from "./budget";
import { stageCalls, type StageState } from "./plan";

type Job = {
  id: string; org_id: string; workspace_id: string; brand_id: string; project_id: string | null; campaign_id: string | null;
  module: string; content_type: string; title: string; status: string; stages: StageState[]; input: { brief: Brief };
  operating_mode: string; attempts: number; max_attempts: number; created_by: string | null;
};

type Ctx = { job: Job; type: ContentType; brand: BrandContext; providers: ProviderRow[]; prefer: RoutingPreference };

class NoProviderError extends Error {}
const COST_CATEGORY: Partial<Record<Capability, string>> = {
  text: "text", research: "text", translation: "text", image: "image", image_edit: "image", layout_image: "rendering",
  video: "video", layout_video: "rendering", voice: "audio", audio: "audio", "3d": "video", document: "rendering",
};

// ---------------------------------------------------------------- provider calls

/** Calls the best provider for a capability, falling back to the next one on failure.
 *  Records usage and cost for every attempt. */
export async function callProvider(
  scope: { org_id: string; workspace_id: string; brand_id: string; project_id: string | null; campaign_id: string | null; job_id: string | null },
  providers: ProviderRow[],
  prefer: RoutingPreference,
  req: ProviderRequest,
  stage: string,
): Promise<ProviderResult & { providerName: string; generative: boolean; cost: number }> {
  const list = candidates(providers, req.capability, prefer, req.task);
  if (!list.length) throw new NoProviderError(`No provider available for "${req.capability}". ${unavailableReason(providers, req.capability)}`);

  let lastError: unknown;
  for (const c of list) {
    await assertWithinBudget(sql, scope, estimateCall(c, req.capability, req.task));
    const started = Date.now();
    try {
      const result = await c.adapter.run(req, c.provider.config);
      const cost = costOf(c.provider.pricing, result.usage);
      await sql.begin(async (tx) => {
        await tx`insert into provider_usage (org_id, workspace_id, brand_id, job_id, provider_id, adapter, model, capability, stage,
                   input_units, output_units, unit, cost_usd, duration_ms)
                 values (${scope.org_id}, ${scope.workspace_id}, ${scope.brand_id}, ${scope.job_id}, ${c.provider.id}, ${c.adapter.key},
                   ${result.model}, ${req.capability}, ${stage}, ${result.usage.input}, ${result.usage.output}, ${result.usage.unit},
                   ${cost}, ${Date.now() - started})`;
        if (cost > 0) {
          await tx`insert into production_costs (org_id, workspace_id, brand_id, project_id, campaign_id, job_id, category, description, amount_usd)
                   values (${scope.org_id}, ${scope.workspace_id}, ${scope.brand_id}, ${scope.project_id}, ${scope.campaign_id}, ${scope.job_id},
                     ${COST_CATEGORY[req.capability] ?? "external"}, ${`${c.provider.name}: ${stage}`}, ${cost})`;
        }
        if (scope.job_id) {
          const used = { name: c.provider.name, adapter: c.adapter.key, model: result.model, capability: req.capability, stage };
          await tx`update content_jobs set actual_cost_usd = actual_cost_usd + ${cost},
                     providers_used = providers_used || ${tx.json(used)}::jsonb where id = ${scope.job_id}`;
        }
      });
      return { ...result, providerName: c.provider.name, generative: c.adapter.generative, cost };
    } catch (e) {
      lastError = e;
      await sql`insert into provider_usage (org_id, workspace_id, brand_id, job_id, provider_id, adapter, capability, stage, status, error, duration_ms)
                values (${scope.org_id}, ${scope.workspace_id}, ${scope.brand_id}, ${scope.job_id}, ${c.provider.id}, ${c.adapter.key},
                  ${req.capability}, ${stage}, 'error', ${String((e as Error).message).slice(0, 2000)}, ${Date.now() - started})`;
    }
  }
  throw lastError;
}

const scopeOf = (job: Job) => ({
  org_id: job.org_id, workspace_id: job.workspace_id, brand_id: job.brand_id,
  project_id: job.project_id, campaign_id: job.campaign_id, job_id: job.id,
});

// ---------------------------------------------------------------- stage state

async function loadPriorOutputs(job: Job): Promise<ProviderRequest["context"]> {
  const scripts = await sql`select id, kind, body, meta from scripts where job_id = ${job.id} order by created_at`;
  const scenes = await sql`select heading, narration, visual_description, duration_seconds from scenes where job_id = ${job.id} order by position`;
  const concept = scripts.findLast((s) => s.kind === "concept");
  return {
    strategy: scripts.findLast((s) => s.kind === "strategy")?.body,
    script: scripts.findLast((s) => s.kind === "script")?.body,
    scenes: scenes.map((s) => ({ heading: s.heading ?? "", narration: s.narration ?? "", visual: s.visual_description ?? "", duration: Number(s.duration_seconds ?? 4) })),
    concept: concept ? (concept.meta as Concept) : undefined,
    body: scripts.findLast((s) => s.kind === "final")?.body,
  };
}

const row = (job: Job) => ({ org_id: job.org_id, workspace_id: job.workspace_id, brand_id: job.brand_id, job_id: job.id });

async function saveText(db: Db, job: Job, kind: string, title: string, body: string, meta: object = {}) {
  const [r] = await db`insert into scripts ${db({ ...row(job), kind, title, body, language: job.input.brief.language, meta: db.json(meta as never) } as never)} returning id`;
  return r.id as string;
}

async function saveFiles(db: Db, job: Job, table: "images" | "videos" | "audio_assets" | "documents", result: ProviderResult, provider: string) {
  let i = 0;
  for (const f of result.files ?? []) {
    const key = jobKey(job, `${table}-${Date.now()}-${i++}.${f.ext}`);
    await storage.put(key, f.data, f.mime);
    const base = { ...row(job), title: f.title, storage_path: key, mime_type: f.mime, meta: db.json({ provider, notes: result.notes ?? [], bytes: f.data.length } as never) };
    const extra =
      table === "images" ? { width: f.width ?? null, height: f.height ?? null }
      : table === "videos" ? { width: f.width ?? null, height: f.height ?? null, duration_seconds: f.duration ?? null }
      : table === "audio_assets" ? { duration_seconds: f.duration ?? null }
      : {};
    await db`insert into ${db(table)} ${db({ ...base, ...extra } as never)}`;
  }
}

// ---------------------------------------------------------------- stage executors

async function runStage(ctx: Ctx, stage: StageState): Promise<Partial<StageState>> {
  const { job, type } = ctx;
  const calls = stageCalls(stage.key, type, ctx.providers);
  if (!calls) return { status: "skipped", note: "No automated work in this stage." };

  const context = await loadPriorOutputs(job);
  const request = (capability: Capability, task?: TextTask): ProviderRequest => ({
    capability, task, contentType: type.key, contentLabel: type.label, brand: ctx.brand, brief: job.input.brief, context,
  });
  const call = (capability: Capability, task?: TextTask) => callProvider(scopeOf(job), ctx.providers, ctx.prefer, request(capability, task), stage.key);
  const note = (r: { notes?: string[] }) => (r.notes ?? []).join(" ") || undefined;

  switch (stage.key) {
    case "research": {
      if (!candidates(ctx.providers, "research").length) {
        return { status: "skipped", note: `No research was done. ${unavailableReason(ctx.providers, "research")}` };
      }
      const r = await call("research");
      await saveText(sql, job, "research", "Research", r.text ?? "", { provider: r.providerName });
      return { status: "done", provider: r.providerName, note: note(r) };
    }
    case "strategy": {
      const r = await call("text", "strategy");
      await saveText(sql, job, "strategy", "Strategy", r.text ?? "", { provider: r.providerName, generative: r.generative });
      return { status: "done", provider: r.providerName, note: note(r) };
    }
    case "script": {
      const r = await call("text", "script");
      const s = r.json as { title?: string; scenes?: Scene[] };
      if (!Array.isArray(s?.scenes) || !s.scenes.length) throw new Error("The provider returned a script without scenes.");
      const body = s.scenes.map((sc, i) => `### ${i + 1}. ${sc.heading} (${sc.duration}s)\n\n${sc.narration}\n\n*Visual:* ${sc.visual}`).join("\n\n");
      await sql.begin(async (tx) => {
        const db = tx as unknown as Db;
        const id = await saveText(db, job, "script", s.title || `${job.title} — script`, body, { provider: r.providerName, generative: r.generative });
        for (let i = 0; i < s.scenes!.length; i++) {
          const sc = s.scenes![i];
          await db`insert into scenes ${db({ ...row(job), script_id: id, position: i + 1, heading: String(sc.heading ?? ""), narration: String(sc.narration ?? ""),
            visual_description: String(sc.visual ?? ""), duration_seconds: Number(sc.duration) || 4 } as never)}`;
        }
      });
      return { status: "done", provider: r.providerName, note: note(r) };
    }
    case "concept": {
      const r = await call("text", "concept");
      const c = r.json as Concept;
      if (!c?.headline) throw new Error("The provider returned a concept without a headline.");
      const body = [`**Headline:** ${c.headline}`, `**Subline:** ${c.subline}`, `**Call to action:** ${c.cta}`, `**Visual:** ${c.visual}`,
        ...(c.slides ?? []).map((s, i) => `${i + 1}. **${s.headline}** — ${s.body}`)].join("\n\n");
      await saveText(sql, job, "concept", "Creative concept", body, { ...c, provider: r.providerName, generative: r.generative });
      return { status: "done", provider: r.providerName, note: note(r) };
    }
    case "generation": {
      const used: string[] = [];
      const notes: string[] = [];
      for (const c of calls) {
        const r = await call(c.capability, c.task);
        used.push(r.providerName);
        if (r.notes) notes.push(...r.notes);
        if (c.capability === "text") {
          context.body = r.text ?? "";
          await saveText(sql, job, "final", job.title, context.body, { provider: r.providerName, generative: r.generative });
        } else {
          if (!r.files?.length) throw new Error("The provider returned no files.");
          const table = c.capability === "document" ? "documents"
            : type.module === "image" ? "images" : type.module === "video" ? "videos" : "audio_assets";
          await sql.begin((tx) => saveFiles(tx as unknown as Db, job, table, r, r.providerName));
        }
      }
      return { status: "done", provider: [...new Set(used)].join(" + "), note: [...new Set(notes)].join(" ") || undefined };
    }
  }
  return { status: "skipped" };
}

/** Automated checks. Errors send the job back for changes; warnings are shown to the approver. */
async function qualityControl(ctx: Ctx): Promise<NonNullable<StageState["report"]>> {
  const { job, brand, type } = ctx;
  const issues: { severity: "error" | "warning"; message: string }[] = [];
  const assets = await sql`select asset_kind, subtype, title, body, storage_path, meta from content_assets where job_id = ${job.id}`;
  const finals = assets.filter((a) => a.asset_kind !== "script" || a.subtype === "final");
  if (!finals.length) issues.push({ severity: "error", message: "No final asset was produced." });

  const texts = assets.filter((a) => a.body).map((a) => ({ title: a.title as string, body: a.body as string }));
  for (const term of brand.guidelines?.banned_terms ?? []) {
    const hit = texts.find((t) => t.body.toLowerCase().includes(term.toLowerCase()));
    if (hit) issues.push({ severity: "error", message: `Banned term "${term}" appears in "${hit.title}".` });
  }
  if (texts.some((t) => t.body.includes("[TO CONFIRM"))) issues.push({ severity: "warning", message: "The content contains [TO CONFIRM] placeholders." });
  if (!brand.guidelines) issues.push({ severity: "warning", message: "This brand has no guidelines; content could not be checked against a brand voice." });
  else if (brand.guidelines.status === "draft") issues.push({ severity: "warning", message: "Brand guidelines are still a draft (not approved)." });
  if (assets.some((a) => a.meta?.generative === false) || finals.some((a) => /template/i.test(String(a.meta?.provider ?? "")))) {
    issues.push({ severity: "warning", message: "Produced by the built-in template engine, not an AI model. Treat the copy as a starting draft." });
  }

  const fmt = FORMATS[job.input.brief.format ?? ""];
  if (fmt && (type.module === "image" || type.module === "video")) {
    const media = await sql`select title, width, height from images where job_id = ${job.id}
                            union all select title, width, height from videos where job_id = ${job.id}`;
    for (const m of media) {
      if (m.width && m.height && Math.abs(m.width / m.height - fmt.w / fmt.h) > 0.01) {
        issues.push({ severity: "error", message: `"${m.title}" is ${m.width}×${m.height}, which does not match the requested ${job.input.brief.format} format.` });
      }
    }
  }
  for (const a of finals.filter((f) => f.storage_path)) {
    const data = await storage.get(a.storage_path);
    if (!data?.length) issues.push({ severity: "error", message: `The file for "${a.title}" is missing or empty.` });
  }
  return { passed: !issues.some((i) => i.severity === "error"), issues };
}

// ---------------------------------------------------------------- job runner

async function setStage(job: Job, key: string, patch: Partial<StageState>) {
  job.stages = job.stages.map((s) => (s.key === key ? { ...s, ...patch } : s));
  await sql`update content_jobs set stages = ${sql.json(job.stages as never)}, current_stage = ${key}, updated_at = now() where id = ${job.id}`;
}

async function finish(job: Job, status: string, extra: { error?: string; requeueInSeconds?: number } = {}) {
  const done = ["approved", "failed", "cancelled", "rejected"].includes(status);
  await sql`update content_jobs set status = ${status}, locked_at = null, locked_by = null, updated_at = now(),
              completed_at = ${done ? sql`now()` : sql`null`},
              run_after = now() + ${extra.requeueInSeconds ?? 0} * interval '1 second',
              errors = ${extra.error ? sql`errors || ${sql.json({ at: new Date().toISOString(), message: extra.error })}::jsonb` : sql`errors`}
            where id = ${job.id}`;
  if (status === "failed") {
    await sql`insert into audit_logs (org_id, workspace_id, actor_kind, action, entity_type, entity_id, detail)
              values (${job.org_id}, ${job.workspace_id}, 'system', 'job.failed', 'content_job', ${job.id}, ${sql.json({ error: extra.error ?? "" })})`;
  }
}

/** Runs a claimed job until it finishes, pauses for a human, or fails. */
export async function runJob(jobId: string): Promise<string> {
  const [job] = (await sql`select * from content_jobs where id = ${jobId}`) as unknown as Job[];
  if (!job) return "missing";
  const type = contentType(job.content_type);
  if (!type) {
    await finish(job, "failed", { error: `Unknown content type "${job.content_type}".` });
    return "failed";
  }
  const [org] = await sql`select emergency_stop, settings from organizations where id = ${job.org_id}`;
  const [ws] = await sql`select automation_mode, full_automation_enabled_by from workspaces where id = ${job.workspace_id}`;
  const ctx: Ctx = {
    job, type,
    brand: await loadBrandContext(sql, job.brand_id),
    providers: await loadProviders(sql, job.org_id),
    prefer: (org.settings?.routing_preference as RoutingPreference) ?? "quality",
  };

  for (const stage of job.stages) {
    if (stage.status === "done" || stage.status === "skipped") continue;

    // Human control: cancellation and the emergency stop are honoured between stages.
    const [live] = await sql`select j.cancel_requested, o.emergency_stop from content_jobs j join organizations o on o.id = j.org_id where j.id = ${job.id}`;
    if (live.cancel_requested) {
      await finish(job, "cancelled");
      return "cancelled";
    }
    if (live.emergency_stop) {
      await sql`update content_jobs set attempts = greatest(attempts - 1, 0) where id = ${job.id}`;
      await finish(job, "queued"); // resumes when the stop is lifted
      return "stopped";
    }

    if (stage.key === "human_approval") {
      await setStage(job, stage.key, { status: "running", started_at: new Date().toISOString() });
      const qc = job.stages.find((s) => s.key === "quality_control")?.report;
      const clean = qc?.passed && !qc.issues.length;
      if (job.operating_mode === "full_automation" && ws.automation_mode === "full_automation" && ws.full_automation_enabled_by && clean) {
        await autoApprove(job, ws.full_automation_enabled_by);
        return "approved";
      }
      await finish(job, "awaiting_approval");
      return "awaiting_approval";
    }
    if (stage.key === "distribution" || stage.key === "analytics") continue; // happen after approval
    if (stage.key === "editing") {
      await setStage(job, stage.key, { status: "skipped", note: "Manual edits are made during review." });
      continue;
    }

    await setStage(job, stage.key, { status: "running", started_at: new Date().toISOString(), note: undefined });
    try {
      if (stage.key === "quality_control") {
        const report = await qualityControl(ctx);
        await setStage(job, stage.key, { status: report.passed ? "done" : "failed", finished_at: new Date().toISOString(), report });
        if (!report.passed) {
          await finish(job, "changes_requested", { error: "Quality control found blocking issues." });
          return "changes_requested";
        }
        continue;
      }
      const patch = await runStage(ctx, stage);
      await setStage(job, stage.key, { ...patch, finished_at: new Date().toISOString() });

      // Assisted mode: the AI proposes, a human reviews the proposal before production continues.
      if (job.operating_mode === "assisted" && (stage.key === "script" || stage.key === "concept") && patch.status === "done") {
        await finish(job, "paused_for_review");
        return "paused_for_review";
      }
    } catch (e) {
      const message = (e as Error).message || "Unknown error";
      const retry = e instanceof RetryableProviderError && job.attempts < job.max_attempts;
      await setStage(job, stage.key, { status: retry ? "pending" : "failed", note: message, finished_at: new Date().toISOString() });
      if (retry) {
        await finish(job, "queued", { error: `${message} (attempt ${job.attempts} of ${job.max_attempts}; retrying)`, requeueInSeconds: 30 * 2 ** (job.attempts - 1) });
        return "retrying";
      }
      const prefix = e instanceof BudgetError ? "Stopped by a spending limit. " : e instanceof NoProviderError ? "" : `Stage "${stage.key}" failed. `;
      await finish(job, "failed", { error: prefix + message });
      return "failed";
    }
  }
  // A workflow without an approval stage still ends in front of a human.
  await finish(job, "awaiting_approval");
  return "awaiting_approval";
}

async function autoApprove(job: Job, enabledBy: string) {
  await sql.begin(async (tx) => {
    await tx`update content_jobs set status = 'awaiting_approval', locked_at = null, locked_by = null where id = ${job.id}`;
    // The approvals trigger moves the job to "approved" and closes the approval stage.
    await tx`insert into approvals (org_id, workspace_id, brand_id, job_id, decision, comment, decided_by)
             values (${job.org_id}, ${job.workspace_id}, ${job.brand_id}, ${job.id}, 'approved',
               'Auto-approved by the full-automation rule (quality control passed with no issues).', ${enabledBy})`;
    await tx`insert into audit_logs (org_id, workspace_id, actor_kind, action, entity_type, entity_id, detail)
             values (${job.org_id}, ${job.workspace_id}, 'system', 'job.auto_approved', 'content_job', ${job.id},
               ${tx.json({ rule_enabled_by: enabledBy })})`;
  });
}

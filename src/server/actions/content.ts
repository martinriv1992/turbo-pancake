"use server";

import { redirect } from "next/navigation";
import { loadBrandContext, loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { contentType, PLATFORMS } from "@/lib/content/catalog";
import { callProvider } from "@/lib/jobs/pipeline";
import type { StageState } from "@/lib/jobs/plan";
import { insertJob, prefer } from "../jobs";
import { audit, dbMessage, done, fail, isRedirect, lines, opt, str } from "../util";

export async function createJobAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const typeKey = str(f, "content_type");
  const back = `/create?brand=${brandId}&type=${typeKey}`;
  const title = str(f, "title");
  const description = str(f, "description");
  if (!title || !description) return fail(back, "Give the content a title and describe the result you want.");
  const type = contentType(typeKey);
  const format = str(f, "format");
  let result: { id: string } | { error: string };
  try {
    result = await ctx.db(async (tx) => {
      const [brand] = await tx`select primary_language from brands where id = ${brandId}`;
      return insertJob(tx, ctx, {
        brandId, typeKey, projectId: opt(f, "project_id"), campaignId: opt(f, "campaign_id"), confirmCost: f.get("confirm_cost") === "on",
        brief: {
          title, description, objective: opt(f, "objective"), key_points: lines(f, "key_points"), cta: opt(f, "cta"),
          language: str(f, "language") || brand?.primary_language || "en",
          platforms: f.getAll("platforms").map(String).filter((p) => PLATFORMS.some((x) => x.key === p)),
          format: type?.formats?.includes(format) ? format : type?.formats?.[0] ?? null, audience: opt(f, "audience"),
        },
      });
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail(back, dbMessage(e));
  }
  if ("error" in result) return fail(back, result.error);
  redirect(`/jobs/${result.id}`);
}

// ---------------------------------------------------------------- job control

const resetFrom = (stages: StageState[], fromKeys: string[]): StageState[] => {
  const start = stages.findIndex((s) => fromKeys.includes(s.key));
  return stages.map((s, i) => (start >= 0 && i >= start ? { key: s.key, status: "pending" } : s));
};

export async function jobControlAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "job_id");
  const op = str(f, "op");
  const back = `/jobs/${id}`;
  let message = "Done.";
  try {
    await ctx.db(async (tx) => {
      const [job] = await tx`select id, status, stages from content_jobs where id = ${id} for update`;
      if (!job) throw Object.assign(new Error(), { code: "42501" });
      const stages = job.stages as StageState[];
      const set = async (patch: object) => {
        const rows = await tx`update content_jobs set ${tx({ ...patch, updated_at: new Date() } as never)} where id = ${id} returning id`;
        if (!rows.length) throw Object.assign(new Error(), { code: "42501" });
      };

      if (op === "cancel") {
        if (job.status === "running") await set({ cancel_requested: true });
        else if (["queued", "paused_for_review", "awaiting_approval", "changes_requested"].includes(job.status)) await set({ status: "cancelled", completed_at: new Date() });
        else throw new Error("This job can no longer be cancelled.");
        message = job.status === "running" ? "Cancellation requested. The job stops after the current stage." : "Job cancelled.";
      } else if (op === "continue") {
        if (job.status !== "paused_for_review") throw new Error("This job is not waiting for a proposal review.");
        await set({ status: "queued", run_after: new Date() });
        message = "Proposal accepted. Production continues.";
      } else if (op === "rerun_qc") {
        if (job.status !== "changes_requested") throw new Error("Quality control can be re-run after changes were requested.");
        await set({ status: "queued", run_after: new Date(), attempts: 0, stages: tx.json(resetFrom(stages, ["quality_control", "human_approval"]) as never) });
        message = "Quality control queued.";
      } else if (op === "regenerate") {
        if (!["changes_requested", "failed", "awaiting_approval", "rejected", "cancelled"].includes(job.status)) throw new Error("This job cannot be regenerated right now.");
        // Keep what is being replaced.
        const assets = await tx`select id, asset_kind, body, storage_path, version from content_assets where job_id = ${id}`;
        const [j] = await tx`select org_id, workspace_id, brand_id from content_jobs where id = ${id}`;
        for (const a of assets) {
          await tx`insert into versions ${tx({ org_id: j.org_id, workspace_id: j.workspace_id, brand_id: j.brand_id, job_id: id, asset_kind: a.asset_kind,
            asset_id: a.id, version_no: a.version, body: a.body, storage_path: a.storage_path, note: "Replaced by regeneration", created_by: ctx.userId } as never)}`;
        }
        for (const t of ["scenes", "scripts", "images", "videos", "audio_assets", "documents"]) await tx`delete from ${tx(t)} where job_id = ${id}`;
        await set({
          status: "queued", run_after: new Date(), attempts: 0, cancel_requested: false, completed_at: null,
          stages: tx.json(resetFrom(stages, ["research", "strategy", "script", "concept", "generation"]) as never),
        });
        message = "Regeneration queued. The previous outputs are kept under Versions.";
      } else throw new Error("Unknown operation.");
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: `job.${op}`, entityType: "content_job", entityId: id });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, message);
}

export async function reviewJobAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "job_id");
  const decision = str(f, "decision");
  const back = `/jobs/${id}`;
  if (!["approved", "changes_requested", "rejected"].includes(decision)) return fail(back, "Unknown decision.");
  const comment = opt(f, "comment");
  if (decision !== "approved" && !comment) return fail(back, "Add a comment explaining what should change.");
  try {
    await ctx.db(async (tx) => {
      const [j] = await tx`select org_id, workspace_id, brand_id from content_jobs where id = ${id}`;
      if (!j) throw Object.assign(new Error(), { code: "42501" });
      // The approvals trigger validates the job state and updates its status.
      await tx`insert into approvals ${tx({ org_id: j.org_id, workspace_id: j.workspace_id, brand_id: j.brand_id, job_id: id, decision, comment, decided_by: ctx.userId } as never)}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: `job.${decision}`, entityType: "content_job", entityId: id });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, decision === "approved" ? "Approved. You can now prepare it for publication." : decision === "rejected" ? "Rejected." : "Changes requested.");
}

/** Human edit of a text asset; the previous text is kept as a version. */
export async function editTextAction(f: FormData) {
  const ctx = await requireContext();
  const jobId = str(f, "job_id");
  const scriptId = str(f, "script_id");
  const body = String(f.get("body") ?? "").trim();
  const back = `/jobs/${jobId}`;
  if (!body) return fail(back, "The text cannot be empty.");
  try {
    await ctx.db(async (tx) => {
      const [s] = await tx`select * from scripts where id = ${scriptId} and job_id = ${jobId}`;
      const [job] = await tx`select status from content_jobs where id = ${jobId}`;
      if (!s || !job) throw Object.assign(new Error(), { code: "42501" });
      if (["approved", "running", "queued"].includes(job.status)) throw new Error("This content cannot be edited in its current state.");
      await tx`insert into versions ${tx({ org_id: s.org_id, workspace_id: s.workspace_id, brand_id: s.brand_id, job_id: jobId, asset_kind: "script",
        asset_id: s.id, version_no: s.version, body: s.body, note: "Before manual edit", created_by: ctx.userId } as never)}`;
      const meta = { ...(s.meta ?? {}), edited_by_human: true };
      // Concept edits also update the structured fields the renderer uses.
      if (s.kind === "concept") Object.assign(meta, { headline: str(f, "headline") || meta.headline, subline: str(f, "subline"), cta: str(f, "cta") || meta.cta });
      await tx`update scripts set body = ${body}, version = version + 1, meta = ${tx.json(meta as never)} where id = ${scriptId}`;
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Saved. The previous text is kept under Versions.");
}

export async function editScenesAction(f: FormData) {
  const ctx = await requireContext();
  const jobId = str(f, "job_id");
  const back = `/jobs/${jobId}`;
  try {
    await ctx.db(async (tx) => {
      const [job] = await tx`select status from content_jobs where id = ${jobId}`;
      if (job?.status !== "paused_for_review") throw new Error("Scenes can be edited while the script is waiting for review.");
      const scenes = await tx`select id from scenes where job_id = ${jobId}`;
      for (const s of scenes) {
        const narration = str(f, `narration_${s.id}`);
        if (narration) await tx`update scenes set narration = ${narration}, heading = ${str(f, `heading_${s.id}`)} where id = ${s.id}`;
      }
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Scenes saved.");
}

// ---------------------------------------------------------------- distribution

export async function preparePublicationAction(f: FormData) {
  const ctx = await requireContext();
  const jobId = str(f, "job_id");
  const back = `/jobs/${jobId}`;
  const targets = f.getAll("targets").map(String);
  if (!targets.length) return fail(back, "Choose at least one platform.");
  const scheduledRaw = str(f, "scheduled_at");
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw + ":00Z") : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return fail(back, "Enter a valid date and time.");
  const captionOverride = String(f.get("caption") ?? "").trim();
  let count = 0;
  try {
    const { job, brand, providers, accounts, source, assets } = await ctx.db(async (tx) => {
      const [job] = await tx`select * from content_jobs where id = ${jobId}`;
      if (!job) throw Object.assign(new Error(), { code: "42501" });
      return {
        job, brand: await loadBrandContext(tx, job.brand_id), providers: await loadProviders(tx, ctx.org.id),
        accounts: await tx`select id, platform, handle from social_accounts where brand_id = ${job.brand_id}`,
        source: (await tx`select body from scripts where job_id = ${jobId} and kind in ('final', 'script', 'concept') order by (kind = 'final') desc, created_at desc limit 1`)[0]?.body as string | undefined,
        assets: await tx`select id, asset_kind from content_assets where job_id = ${jobId} and (asset_kind <> 'script' or subtype = 'final')`,
      };
    });
    if (job.status !== "approved") return fail(back, "Only approved content can be prepared for publication.");

    const rows: { platform: string; social_account_id: string | null; caption: string }[] = [];
    for (const t of targets) {
      const account = accounts.find((a) => `account:${a.id}` === t);
      const platform = account?.platform ?? (t.startsWith("platform:") ? t.slice(9) : "");
      if (!PLATFORMS.some((p) => p.key === platform)) continue;
      let caption = captionOverride;
      if (!caption) {
        const r = await callProvider(
          { org_id: job.org_id, workspace_id: job.workspace_id, brand_id: job.brand_id, project_id: job.project_id, campaign_id: job.campaign_id, job_id: job.id },
          providers, prefer(ctx),
          { capability: "text", task: "platform_caption", contentType: job.content_type, contentLabel: contentType(job.content_type)?.label ?? job.content_type,
            brand, brief: job.input.brief, context: { body: source, platform: PLATFORMS.find((p) => p.key === platform)!.label } },
          "distribution",
        );
        caption = r.text ?? "";
      }
      rows.push({ platform, social_account_id: account?.id ?? null, caption });
    }
    if (!rows.length) return fail(back, "Choose at least one platform.");

    const status = !ctx.can.publish ? "draft" : scheduledAt && scheduledAt > new Date() ? "scheduled" : "ready_manual";
    await ctx.db(async (tx) => {
      for (const r of rows) {
        await tx`insert into publication_jobs ${tx({
          org_id: job.org_id, workspace_id: job.workspace_id, brand_id: job.brand_id, job_id: job.id, campaign_id: job.campaign_id, ...r,
          asset_refs: tx.json(assets.map((a) => ({ asset_kind: a.asset_kind, asset_id: a.id })) as never), mode: "manual_package", status,
          scheduled_at: scheduledAt, created_by: ctx.userId,
          log: tx.json([{ at: new Date().toISOString(), event: "prepared", detail: `Prepared as a manual publishing package (${status}).` }] as never),
        } as never)}`;
        count++;
      }
      const stages = (job.stages as StageState[]).map((s) => (s.key === "distribution" ? { ...s, status: "done", finished_at: new Date().toISOString(), note: "Publication packages prepared." } : s));
      if (ctx.can.edit) await tx`update content_jobs set stages = ${tx.json(stages as never)}, current_stage = 'distribution' where id = ${job.id}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "publication.prepared", entityType: "content_job", entityId: job.id, detail: { count, status } });
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail(back, dbMessage(e));
  }
  redirect(`/distribution?ok=${encodeURIComponent(`${count} publication package${count === 1 ? "" : "s"} prepared.`)}`);
}

export async function publicationAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "publication_id");
  const op = String(f.getAll("op").at(-1) ?? "");
  const back = `/distribution/${id}`;
  let message = "Done.";
  try {
    await ctx.db(async (tx) => {
      const [p] = await tx`select * from publication_jobs where id = ${id} for update`;
      if (!p) throw Object.assign(new Error(), { code: "42501" });
      const log = (event: string, detail: string) => tx.json([...(p.log as object[]), { at: new Date().toISOString(), event, detail, by: ctx.email }] as never);
      const update = async (patch: object) => {
        const rows = await tx`update publication_jobs set ${tx(patch as never)} where id = ${id} returning id`;
        if (!rows.length) throw Object.assign(new Error(), { code: "42501" });
      };
      const base = { org_id: p.org_id, workspace_id: p.workspace_id, brand_id: p.brand_id, publication_job_id: id };

      if (op === "confirm") {
        const url = str(f, "external_url");
        if (!/^https?:\/\/\S+\.\S+/.test(url)) throw new Error("Paste the link to the live post to confirm publication.");
        if (!["ready_manual", "scheduled", "failed"].includes(p.status)) throw new Error("This publication cannot be confirmed in its current state.");
        await tx`insert into publication_results ${tx({ ...base, status: "confirmed", confirmation: "manual", external_url: url, confirmed_by: ctx.userId } as never)}`;
        await update({ status: "published", log: log("confirmed", `Publication confirmed manually: ${url}`) });
        message = "Publication confirmed.";
      } else if (op === "fail") {
        const detail = str(f, "detail") || "Publishing attempt failed.";
        const attempts = p.attempts + 1;
        const exhausted = attempts >= p.max_attempts;
        await update({ attempts, last_error: detail, status: exhausted ? "failed" : "ready_manual",
          log: log("attempt_failed", `${detail} (attempt ${attempts} of ${p.max_attempts}${exhausted ? "; no retries left" : "; ready to retry"})`) });
        message = exhausted ? "Marked as failed: no retries left." : "Failure recorded. The package is ready to retry.";
      } else if (op === "reschedule") {
        const at = new Date(str(f, "scheduled_at") + ":00Z");
        if (Number.isNaN(at.getTime())) throw new Error("Enter a valid date and time.");
        await update({ scheduled_at: at, status: at > new Date() ? "scheduled" : "ready_manual", attempts: 0, last_error: null, log: log("rescheduled", `Scheduled for ${at.toISOString()}`) });
        message = "Schedule updated.";
      } else if (op === "caption") {
        if (p.status === "published") throw new Error("A published post's caption cannot be changed here.");
        await update({ caption: String(f.get("caption") ?? "").trim(), log: log("edited", "Caption edited.") });
        message = "Caption saved.";
      } else if (op === "cancel") {
        if (p.status === "published") throw new Error("A confirmed publication cannot be cancelled.");
        await update({ status: "cancelled", log: log("cancelled", "Publication cancelled.") });
        message = "Publication cancelled.";
      } else throw new Error("Unknown operation.");
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: `publication.${op}`, entityType: "publication_job", entityId: id });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, message);
}

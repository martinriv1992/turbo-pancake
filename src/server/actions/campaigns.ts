"use server";

import { redirect } from "next/navigation";
import { loadBrandContext, loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { contentType } from "@/lib/content/catalog";
import { callProvider } from "@/lib/jobs/pipeline";
import { insertJob, prefer } from "../jobs";
import { audit, dbMessage, done, fail, isRedirect, lines, num, opt, str } from "../util";

type PlanItem = { content_type: string; title: string; description: string; day_offset: number; job_id?: string; skipped?: string };

/** Creates a campaign and drafts its plan (strategy + asset list) with the text provider. */
export async function createCampaignAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const name = str(f, "name");
  const objective = str(f, "objective");
  if (!brandId || !name || !objective) return fail("/campaigns", "Choose a brand and give the campaign a name and an objective.");
  if (!ctx.can.edit) return fail("/campaigns", "You do not have permission to do that.");
  let id: string;
  try {
    const { brand, providers } = await ctx.db(async (tx) => ({ brand: await loadBrandContext(tx, brandId), providers: await loadProviders(tx, ctx.org.id) }));
    id = await ctx.db(async (tx) => {
      const [c] = await tx`insert into campaigns ${tx({
        org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: brandId, project_id: opt(f, "project_id"), name, objective,
        key_message: opt(f, "key_message"), start_date: opt(f, "start_date"), end_date: opt(f, "end_date"), budget_usd: num(f, "budget_usd"), created_by: ctx.userId,
      } as never)} returning id`;
      return c.id as string;
    });
    const r = await callProvider(
      { org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: brandId, project_id: null, campaign_id: id, job_id: null },
      providers, prefer(ctx),
      {
        capability: "text", task: "campaign_plan", contentType: "campaign", contentLabel: "Campaign", brand,
        brief: { title: name, description: str(f, "description") || objective, objective, key_points: lines(f, "key_message"), cta: opt(f, "cta"),
          language: brand.language, platforms: [], audience: opt(f, "audience") },
        context: {},
      },
      "campaign_plan",
    );
    const plan = r.json as { strategy?: string; assets?: PlanItem[] };
    const items = (plan.assets ?? [])
      .filter((a) => contentType(a.content_type))
      .map((a) => ({ content_type: a.content_type, title: String(a.title), description: String(a.description), day_offset: Math.max(0, Math.round(Number(a.day_offset) || 0)) }));
    await ctx.db(async (tx) => {
      await tx`update campaigns set strategy = ${plan.strategy ?? ""}, plan = ${tx.json(items as never)}, plan_provider = ${r.providerName} where id = ${id}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "campaign.created", entityType: "campaign", entityId: id, detail: { provider: r.providerName } });
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail("/campaigns", dbMessage(e));
  }
  redirect(`/campaigns/${id}?ok=${encodeURIComponent("Campaign planned. Review the plan, then produce the assets.")}`);
}

/** Starts a production job for every planned asset that does not have one yet. */
export async function produceCampaignAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "campaign_id");
  const back = `/campaigns/${id}`;
  let started = 0, skipped = 0;
  try {
    await ctx.db(async (tx) => {
      const [c] = await tx`select * from campaigns where id = ${id} for update`;
      if (!c) throw Object.assign(new Error(), { code: "42501" });
      const [brand] = await tx`select primary_language from brands where id = ${c.brand_id}`;
      const plan = c.plan as PlanItem[];
      for (const item of plan) {
        if (item.job_id) continue;
        const type = contentType(item.content_type)!;
        const result = await insertJob(tx, ctx, {
          brandId: c.brand_id, typeKey: item.content_type, projectId: c.project_id, campaignId: id, confirmCost: f.get("confirm_cost") === "on",
          extraInput: { day_offset: item.day_offset },
          brief: { title: item.title, description: item.description, objective: c.objective, key_points: c.key_message ? [c.key_message] : [],
            language: brand.primary_language, platforms: [], format: type.formats?.[0] ?? null },
        });
        if ("error" in result) { item.skipped = result.error; skipped++; }
        else { item.job_id = result.id; delete item.skipped; started++; }
      }
      await tx`update campaigns set plan = ${tx.json(plan as never)}, status = ${started ? "in_production" : c.status} where id = ${id}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "campaign.produced", entityType: "campaign", entityId: id, detail: { started, skipped } });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, `${started} production job${started === 1 ? "" : "s"} started${skipped ? `; ${skipped} could not start (see the plan for why)` : ""}.`);
}

export async function setCampaignStatusAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "campaign_id");
  const status = str(f, "status");
  if (!["draft", "in_production", "active", "completed", "archived"].includes(status)) return fail(`/campaigns/${id}`, "Unknown status.");
  try {
    await ctx.db((tx) => tx`update campaigns set status = ${status} where id = ${id}`);
  } catch (e) {
    return fail(`/campaigns/${id}`, dbMessage(e));
  }
  done(`/campaigns/${id}`, "Campaign status updated.");
}

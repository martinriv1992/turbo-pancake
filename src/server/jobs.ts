// Server-only helpers shared by actions (not exposed as server actions themselves).
import { loadProviders } from "@/lib/brand-context";
import type { AppContext } from "@/lib/context";
import type { Db } from "@/lib/db";
import type { RoutingPreference } from "@/lib/ai/registry";
import type { Brief } from "@/lib/ai/types";
import { contentType } from "@/lib/content/catalog";
import { assertWithinBudget } from "@/lib/jobs/budget";
import { initialStages, planJob, resolveWorkflow } from "@/lib/jobs/plan";
import { audit } from "./util";

export const prefer = (ctx: AppContext) => (ctx.org.settings.routing_preference as RoutingPreference) ?? "quality";

/** Creates a brief + queued production job inside an RLS transaction. Shared with Campaign Studio. */
export async function insertJob(
  tx: Db,
  ctx: AppContext,
  a: { brandId: string; typeKey: string; brief: Brief; projectId?: string | null; campaignId?: string | null; confirmCost: boolean; extraInput?: object },
): Promise<{ id: string } | { error: string }> {
  const type = contentType(a.typeKey);
  if (!type) return { error: "Choose a content type." };
  const [brand] = await tx`select id from brands where id = ${a.brandId} and workspace_id = ${ctx.workspace.id} and status = 'active'`;
  if (!brand) return { error: "Choose a brand in this workspace." };

  const workflow = await resolveWorkflow(tx, { orgId: ctx.org.id, brandId: a.brandId, module: type.module, contentType: type.key });
  const plan = planJob(type, workflow, await loadProviders(tx, ctx.org.id), prefer(ctx));
  if (plan.blocked) return { error: plan.blocked };
  if (plan.total > 0 && !a.confirmCost) return { error: `This production is estimated at $${plan.total.toFixed(4)}. Tick the box to confirm the cost.` };
  await assertWithinBudget(tx, { org_id: ctx.org.id, brand_id: a.brandId, project_id: a.projectId ?? null, campaign_id: a.campaignId ?? null }, plan.total);

  const base = { org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: a.brandId, project_id: a.projectId ?? null, campaign_id: a.campaignId ?? null };
  const [brief] = await tx`insert into content_briefs ${tx({
    ...base, title: a.brief.title, content_type: type.key, description: a.brief.description, objective: a.brief.objective ?? null,
    language: a.brief.language, platforms: a.brief.platforms, format: a.brief.format ?? null, key_points: a.brief.key_points,
    cta: a.brief.cta ?? null, created_by: ctx.userId,
  } as never)} returning id`;
  const [job] = await tx`insert into content_jobs ${tx({
    ...base, brief_id: brief.id, module: type.module, content_type: type.key, title: a.brief.title,
    stages: tx.json(initialStages(plan) as never), current_stage: "brief",
    input: tx.json({ brief: a.brief, workflow: plan.workflow, ...(a.extraInput ?? {}) } as never),
    operating_mode: ctx.workspace.automationMode, estimated_cost_usd: plan.total, created_by: ctx.userId,
  } as never)} returning id`;
  await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "job.created", entityType: "content_job", entityId: job.id,
    detail: { content_type: type.key, estimate: plan.total, mode: ctx.workspace.automationMode } });
  return { id: job.id as string };
}


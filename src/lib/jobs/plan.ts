// Turns a content type + workflow into an executable plan: which capability each stage
// needs, which provider will serve it, and what it is expected to cost.
import type { Db } from "@/lib/db";
import { candidates, estimateCall, unavailableReason, type RoutingPreference } from "@/lib/ai/registry";
import type { Capability, ProviderRow, TextTask } from "@/lib/ai/types";
import type { ContentType } from "@/lib/content/catalog";

export type StageState = {
  key: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  started_at?: string;
  finished_at?: string;
  note?: string;
  provider?: string;
  report?: { passed: boolean; issues: { severity: "error" | "warning"; message: string }[] };
};

export async function resolveWorkflow(
  db: Db,
  a: { orgId: string; brandId: string; module: string; contentType: string },
): Promise<{ name: string; stages: string[] }> {
  const rows = await db`
    select name, stages from workflows
    where module = ${a.module}
      and (content_type is null or content_type = ${a.contentType})
      and (org_id is null or org_id = ${a.orgId})
      and (brand_id is null or brand_id = ${a.brandId})
    order by (brand_id is not null) desc, (org_id is not null) desc, (content_type is not null) desc, created_at desc
    limit 1`;
  if (!rows.length) throw new Error(`No workflow is defined for ${a.module}`);
  return { name: rows[0].name, stages: rows[0].stages as string[] };
}

export type Call = { capability: Capability; task?: TextTask };

/** Provider calls a stage makes. Stages not listed here (brief, QC, approval…) call no provider. */
export function stageCalls(stage: string, type: ContentType, providers: ProviderRow[]): Call[] | null {
  switch (stage) {
    case "research":
      return [{ capability: "research" }];
    case "strategy":
      return [{ capability: "text", task: "strategy" }];
    case "script":
      return [{ capability: "text", task: "script" }];
    case "concept":
      return [{ capability: "text", task: "concept" }];
    case "generation": {
      if (type.module === "writing") return [{ capability: "text", task: "final_text" }];
      if (type.module === "document") return [{ capability: "text", task: "document_body" }, { capability: "document" }];
      // First capability in the type's preference order that has a provider right now.
      const cap = type.produces.find((c) => candidates(providers, c).length) ?? type.produces[0];
      return [{ capability: cap }];
    }
    default:
      return null;
  }
}

export type PlanStage = { key: string; provider?: string; generative?: boolean; estimate: number; skipped?: string };
export type Plan = { workflow: string; stages: PlanStage[]; total: number; blocked?: string; usesAI: boolean };

export function planJob(
  type: ContentType,
  workflow: { name: string; stages: string[] },
  providers: ProviderRow[],
  prefer: RoutingPreference,
): Plan {
  const plan: Plan = { workflow: workflow.name, stages: [], total: 0, usesAI: false };
  for (const key of workflow.stages) {
    const calls = stageCalls(key, type, providers);
    const stage: PlanStage = { key, estimate: 0 };
    for (const call of calls ?? []) {
      const [best] = candidates(providers, call.capability, prefer, call.task);
      if (!best) {
        const reason = unavailableReason(providers, call.capability);
        if (key === "research") stage.skipped = `Skipped: ${reason}`;
        else plan.blocked ??= `${type.label} needs a provider for "${call.capability}". ${reason}`;
        continue;
      }
      stage.provider = stage.provider ? `${stage.provider} + ${best.provider.name}` : best.provider.name;
      stage.generative = stage.generative || best.adapter.generative;
      stage.estimate += estimateCall(best, call.capability, call.task);
      plan.usesAI ||= best.adapter.generative;
    }
    plan.total += stage.estimate;
    plan.stages.push(stage);
  }
  return plan;
}

export const initialStages = (plan: Plan): StageState[] =>
  plan.stages.map((s, i) =>
    i === 0 && s.key === "brief"
      ? { key: s.key, status: "done", finished_at: new Date().toISOString() }
      : { key: s.key, status: "pending" },
  );

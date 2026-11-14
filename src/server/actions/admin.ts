"use server";

import { ADAPTERS } from "@/lib/ai/registry";
import { requireContext } from "@/lib/context";
import { sql } from "@/lib/db";
import { PLATFORMS } from "@/lib/content/catalog";
import { audit, dbMessage, done, fail, num, opt, str } from "../util";

const denied = () => Object.assign(new Error(), { code: "42501" });

// ---------------------------------------------------------------- workspaces & clients

export async function createWorkspaceAction(f: FormData) {
  const ctx = await requireContext();
  const name = str(f, "name");
  if (!name) return fail("/workspaces", "Give the workspace a name.");
  try {
    await ctx.db(async (tx) => {
      const [w] = await tx`insert into workspaces (org_id, name, description) values (${ctx.org.id}, ${name}, ${opt(f, "description")}) returning id`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: w.id, userId: ctx.userId, action: "workspace.created", entityType: "workspace", entityId: w.id });
    });
  } catch (e) {
    return fail("/workspaces", dbMessage(e));
  }
  done("/workspaces", `Workspace “${name}” created. Switch to it from the menu at the top left.`);
}

export async function addClientAction(f: FormData) {
  const ctx = await requireContext();
  try {
    await ctx.db((tx) => tx`insert into clients ${tx({ org_id: ctx.org.id, workspace_id: ctx.workspace.id, name: str(f, "name"),
      contact_name: opt(f, "contact_name"), contact_email: opt(f, "contact_email"), notes: opt(f, "notes") } as never)}`);
  } catch (e) {
    return fail("/workspaces", dbMessage(e));
  }
  done("/workspaces", "Client added.");
}

export async function deleteClientAction(f: FormData) {
  const ctx = await requireContext();
  try {
    await ctx.db((tx) => tx`delete from clients where id = ${str(f, "id")}`);
  } catch (e) {
    return fail("/workspaces", dbMessage(e));
  }
  done("/workspaces", "Client removed.");
}

// ---------------------------------------------------------------- members

export async function addMemberAction(f: FormData) {
  const ctx = await requireContext();
  if (!ctx.can.manage) return fail("/settings", "You do not have permission to manage members.");
  const email = str(f, "email").toLowerCase();
  // Looking up an account by email needs the service connection; the membership insert
  // itself runs under RLS (which also blocks granting a role above your own).
  const [user] = await sql`select id from profiles where lower(email) = ${email}`;
  if (!user) return fail("/settings", "No account uses that email yet. Ask them to sign up first, then add them here.");
  const scope = str(f, "scope") === "workspace" ? ctx.workspace.id : null;
  try {
    await ctx.db(async (tx) => {
      await tx`insert into memberships (org_id, workspace_id, user_id, role) values (${ctx.org.id}, ${scope}, ${user.id}, ${str(f, "role")})`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: scope, userId: ctx.userId, action: "member.added", entityType: "user", entityId: user.id, detail: { role: str(f, "role") } });
    });
  } catch (e) {
    return fail("/settings", dbMessage(e));
  }
  done("/settings", "Member added.");
}

export async function removeMemberAction(f: FormData) {
  const ctx = await requireContext();
  try {
    await ctx.db(async (tx) => {
      const [m] = await tx`select user_id, role from memberships where id = ${str(f, "id")}`;
      if (!m) throw denied();
      if (m.role === "owner") {
        const [{ n }] = await tx`select count(*)::int as n from memberships where org_id = ${ctx.org.id} and role = 'owner'`;
        if (n <= 1) throw new Error("An organization must keep at least one owner.");
      }
      const rows = await tx`delete from memberships where id = ${str(f, "id")} returning id`;
      if (!rows.length) throw denied();
      await audit(tx, { orgId: ctx.org.id, userId: ctx.userId, action: "member.removed", entityType: "user", entityId: m.user_id });
    });
  } catch (e) {
    return fail("/settings", dbMessage(e));
  }
  done("/settings", "Member removed.");
}

export async function updateOrganizationAction(f: FormData) {
  const ctx = await requireContext();
  const back = str(f, "back") || "/settings";
  const routing = ["quality", "cost", "speed"].includes(str(f, "routing_preference")) ? str(f, "routing_preference") : null;
  try {
    await ctx.db(async (tx) => {
      const patch: Record<string, unknown> = {};
      if (f.has("name") && str(f, "name")) patch.name = str(f, "name");
      if (f.has("monthly_budget_usd")) patch.monthly_budget_usd = num(f, "monthly_budget_usd");
      if (routing) patch.settings = tx.json({ ...ctx.org.settings, routing_preference: routing } as never);
      const rows = await tx`update organizations set ${tx(patch as never)} where id = ${ctx.org.id} returning id`;
      if (!rows.length) throw denied();
      await audit(tx, { orgId: ctx.org.id, userId: ctx.userId, action: "organization.updated", detail: { fields: Object.keys(patch) } });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Saved.");
}

// ---------------------------------------------------------------- AI providers

export async function addProviderAction(f: FormData) {
  const ctx = await requireContext();
  const adapter = ADAPTERS[str(f, "adapter")];
  if (!adapter) return fail("/providers", "Unknown provider type.");
  try {
    await ctx.db(async (tx) => {
      const [p] = await tx`insert into ai_providers ${tx({
        org_id: ctx.org.id, adapter: adapter.key, name: str(f, "name") || adapter.label, capabilities: adapter.capabilities,
        config: tx.json(adapter.defaultConfig as never), pricing: tx.json(adapter.defaultPricing as never),
        quality: adapter.defaultQuality, speed: adapter.defaultSpeed, priority: adapter.generative ? 100 : 900,
      } as never)} returning id`;
      await audit(tx, { orgId: ctx.org.id, userId: ctx.userId, action: "provider.added", entityType: "ai_provider", entityId: p.id, detail: { adapter: adapter.key } });
    });
  } catch (e) {
    return fail("/providers", dbMessage(e));
  }
  done("/providers", `${adapter.label} added. Check its settings below.`);
}

export async function updateProviderAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "id");
  const op = String(f.getAll("op").at(-1) ?? "save");
  try {
    await ctx.db(async (tx) => {
      const [p] = await tx`select adapter, config from ai_providers where id = ${id}`;
      const adapter = p && ADAPTERS[p.adapter];
      if (!adapter) throw denied();
      if (op === "delete") {
        const rows = await tx`delete from ai_providers where id = ${id} returning id`;
        if (!rows.length) throw denied();
      } else {
        const keyEnv = str(f, "api_key_env");
        // Only names that look like API-key variables may be referenced, so a provider
        // can never be pointed at an unrelated server secret.
        if (keyEnv && !/^[A-Z][A-Z0-9_]*_API_KEY$/.test(keyEnv)) throw new Error("The key variable must be an environment variable name ending in _API_KEY.");
        const pricing: Record<string, number> = {};
        for (const k of ["input_per_mtok", "output_per_mtok", "per_image", "per_second", "per_render"]) {
          const v = num(f, `price_${k}`);
          if (v != null) pricing[k] = v;
        }
        const caps = f.getAll("capabilities").map(String).filter((c) => (adapter.capabilities as string[]).includes(c));
        const clamp = (k: string, d: number) => Math.min(5, Math.max(1, Math.round(num(f, k) ?? d)));
        const rows = await tx`update ai_providers set ${tx({
          name: str(f, "name") || adapter.label, enabled: f.get("enabled") === "on", priority: Math.round(num(f, "priority") ?? 100),
          capabilities: caps, quality: clamp("quality", 3), speed: clamp("speed", 3), pricing: tx.json(pricing as never),
          config: tx.json({ ...p.config, ...(f.has("model") ? { model: str(f, "model") } : {}), ...(keyEnv ? { api_key_env: keyEnv } : {}),
            ...(f.has("effort") ? { effort: str(f, "effort") } : {}) } as never),
        } as never)} where id = ${id} returning id`;
        if (!rows.length) throw denied();
      }
      await audit(tx, { orgId: ctx.org.id, userId: ctx.userId, action: `provider.${op === "delete" ? "removed" : "updated"}`, entityType: "ai_provider", entityId: id });
    });
  } catch (e) {
    return fail("/providers", dbMessage(e));
  }
  done("/providers", op === "delete" ? "Provider removed." : "Provider saved.");
}

// ---------------------------------------------------------------- automation & human control

export async function setAutomationModeAction(f: FormData) {
  const ctx = await requireContext();
  const mode = str(f, "mode");
  if (!["assisted", "autonomous_production", "full_automation"].includes(mode)) return fail("/automations", "Unknown mode.");
  if (mode === "full_automation" && str(f, "confirm") !== "ENABLE FULL AUTOMATION") {
    return fail("/automations", "To turn on full automation, type ENABLE FULL AUTOMATION exactly in the confirmation box.");
  }
  try {
    await ctx.db(async (tx) => {
      const patch = mode === "full_automation"
        ? { automation_mode: mode, full_automation_enabled_at: new Date(), full_automation_enabled_by: ctx.userId }
        : { automation_mode: mode, full_automation_enabled_at: null, full_automation_enabled_by: null };
      const rows = await tx`update workspaces set ${tx(patch as never)} where id = ${ctx.workspace.id} returning id`;
      if (!rows.length) throw denied();
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "automation.mode_changed", detail: { mode } });
    });
  } catch (e) {
    return fail("/automations", dbMessage(e));
  }
  done("/automations", `Operating mode set to ${mode.replace(/_/g, " ")}. It applies to jobs created from now on.`);
}

export async function emergencyStopAction(f: FormData) {
  const ctx = await requireContext();
  const on = str(f, "state") === "on";
  try {
    await ctx.db(async (tx) => {
      const rows = await tx`update organizations set emergency_stop = ${on}, emergency_stop_at = ${on ? new Date() : null},
                              emergency_stop_by = ${on ? ctx.userId : null} where id = ${ctx.org.id} returning id`;
      if (!rows.length) throw denied();
      await audit(tx, { orgId: ctx.org.id, userId: ctx.userId, action: on ? "emergency_stop.activated" : "emergency_stop.lifted" });
    });
  } catch (e) {
    return fail("/automations", dbMessage(e));
  }
  done("/automations", on ? "Emergency stop activated. No job will start, and running jobs halt after their current stage." : "Emergency stop lifted. Queued jobs resume.");
}

// ---------------------------------------------------------------- analytics

const METRICS = ["views", "reach", "engagement", "retention", "watch_time", "clicks", "shares", "followers", "conversions", "revenue"];

export async function recordMetricAction(f: FormData) {
  const ctx = await requireContext();
  const value = num(f, "value");
  const start = str(f, "period_start"), end = str(f, "period_end") || start;
  if (value == null || !METRICS.includes(str(f, "metric")) || !PLATFORMS.some((p) => p.key === str(f, "platform")) || !start) {
    return fail("/analytics", "Enter a platform, metric, value and period.");
  }
  if (end < start) return fail("/analytics", "The period end cannot be before its start.");
  try {
    await ctx.db(async (tx) => {
      const pubId = opt(f, "publication_job_id");
      const [pub] = pubId ? await tx`select job_id, campaign_id, brand_id from publication_jobs where id = ${pubId}` : [];
      await tx`insert into analytics ${tx({
        org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: pub?.brand_id ?? str(f, "brand_id"), campaign_id: pub?.campaign_id ?? null,
        job_id: pub?.job_id ?? null, publication_job_id: pubId, platform: str(f, "platform"), metric: str(f, "metric"), value,
        period_start: start, period_end: end, source: "manual", recorded_by: ctx.userId,
      } as never)}`;
    });
  } catch (e) {
    return fail("/analytics", dbMessage(e));
  }
  done("/analytics", "Metric recorded.");
}

export async function deleteMetricAction(f: FormData) {
  const ctx = await requireContext();
  try {
    await ctx.db((tx) => tx`delete from analytics where id = ${str(f, "id")}`);
  } catch (e) {
    return fail("/analytics", dbMessage(e));
  }
  done("/analytics", "Metric removed.");
}

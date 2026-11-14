"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadBrandContext, loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { callProvider } from "@/lib/jobs/pipeline";
import type { RoutingPreference } from "@/lib/ai/registry";
import { innerworksSample } from "@/lib/samples/innerworks";
import { brandKey, storage } from "@/lib/storage";
import { audit, dbMessage, done, fail, isRedirect, lines, num, opt, slugify, str } from "../util";

const hex = (v: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

function paletteFrom(f: FormData) {
  return (["primary", "accent", "neutral"] as const)
    .map((role) => ({ role, hex: hex(str(f, `color_${role}`)), name: str(f, `color_${role}_name`) || role }))
    .filter((p) => p.hex) as { role: string; hex: string; name: string }[];
}

export async function createBrandAction(f: FormData) {
  const ctx = await requireContext();
  const name = str(f, "name");
  if (!name) return fail("/brands", "Give the brand a name.");
  let id: string;
  try {
    id = await ctx.db(async (tx) => {
      const [b] = await tx`
        insert into brands ${tx({
          org_id: ctx.org.id, workspace_id: ctx.workspace.id, name, slug: `${slugify(name)}-${Date.now().toString(36).slice(-4)}`,
          tagline: opt(f, "tagline"), website: opt(f, "website"), industry: opt(f, "industry"), market: opt(f, "market"),
          description: opt(f, "description"), primary_language: str(f, "language") || "en", languages: [str(f, "language") || "en"],
          palette: tx.json(paletteFrom(f) as never), created_by: ctx.userId,
        } as never)} returning id`;
      await tx`insert into brand_guidelines (org_id, workspace_id, brand_id) values (${ctx.org.id}, ${ctx.workspace.id}, ${b.id})`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "brand.created", entityType: "brand", entityId: b.id });
      return b.id as string;
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail("/brands", dbMessage(e));
  }
  redirect(`/brand-builder?brand=${id}&ok=${encodeURIComponent("Brand created. Define its identity below.")}`);
}

export async function updateBrandAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "brand_id");
  const back = `/brands/${id}`;
  try {
    await ctx.db(async (tx) => {
      await tx`update brands set ${tx({
        name: str(f, "name"), tagline: opt(f, "tagline"), website: opt(f, "website"), industry: opt(f, "industry"),
        market: opt(f, "market"), description: opt(f, "description"), primary_language: str(f, "language") || "en",
        palette: tx.json(paletteFrom(f) as never),
        typography: tx.json({ heading: str(f, "font_heading"), body: str(f, "font_body") } as never),
        monthly_budget_usd: num(f, "monthly_budget_usd"), updated_at: new Date(),
      } as never)} where id = ${id}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "brand.updated", entityType: "brand", entityId: id });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Brand identity saved.");
}

/** Adds one row to a brand-owned table (audiences, products, social accounts, projects). */
export async function addBrandItemAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const kind = str(f, "kind");
  const back = `/brands/${brandId}`;
  const base = { org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: brandId };
  try {
    await ctx.db(async (tx) => {
      if (kind === "audience") {
        await tx`insert into audiences ${tx({ ...base, name: str(f, "name"), description: opt(f, "description"), pains: lines(f, "pains"), desires: lines(f, "desires") } as never)}`;
      } else if (kind === "product") {
        await tx`insert into products ${tx({ ...base, name: str(f, "name"), description: opt(f, "description"), price: opt(f, "price"), url: opt(f, "url"), features: lines(f, "features") } as never)}`;
      } else if (kind === "social") {
        await tx`insert into social_accounts ${tx({ ...base, platform: str(f, "platform"), handle: str(f, "handle"), display_name: opt(f, "display_name") } as never)}`;
      } else if (kind === "project") {
        await tx`insert into projects ${tx({ ...base, name: str(f, "name"), description: opt(f, "description"), budget_usd: num(f, "budget_usd"), created_by: ctx.userId } as never)}`;
      } else throw new Error("Unknown item type.");
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Added.");
}

const DELETABLE: Record<string, string> = { audience: "audiences", product: "products", social: "social_accounts", asset: "brand_assets" };

export async function deleteBrandItemAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const table = DELETABLE[str(f, "kind")];
  const back = `/brands/${brandId}`;
  if (!table) return fail(back, "Unknown item type.");
  try {
    await ctx.db((tx) => tx`delete from ${tx(table)} where id = ${str(f, "id")} and brand_id = ${brandId}`);
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Removed.");
}

const UPLOAD_TYPES = /^(image\/(png|jpeg|webp|gif|svg\+xml)|application\/pdf|text\/plain|font\/(ttf|otf|woff2?))$/;

export async function uploadBrandAssetAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const back = `/brands/${brandId}`;
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return fail(back, "Choose a file to upload.");
  if (file.size > 20 * 1024 * 1024) return fail(back, "Files can be up to 20 MB.");
  if (!UPLOAD_TYPES.test(file.type)) return fail(back, "Supported: PNG, JPEG, WebP, GIF, SVG, PDF, plain text and font files.");
  try {
    // Check write access (RLS) before touching storage.
    const [brand] = await ctx.db((tx) => tx`select id, org_id from brands where id = ${brandId}`);
    if (!brand || !ctx.can.edit) return fail(back, "You do not have permission to do that.");
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const key = brandKey({ org_id: brand.org_id, id: brandId }, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
    await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
    await ctx.db((tx) => tx`insert into brand_assets ${tx({
      org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: brandId, kind: str(f, "asset_kind") || "reference",
      title: str(f, "title") || file.name, storage_path: key, mime_type: file.type, size_bytes: file.size,
      approved: f.get("approved") === "on" && ctx.can.approve, created_by: ctx.userId,
    } as never)}`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail(back, dbMessage(e));
  }
  done(back, "Asset uploaded.");
}

// ---------------------------------------------------------------- Brand Builder

function guidelineFields(f: FormData) {
  return {
    positioning: opt(f, "positioning"), personality: lines(f, "personality"), tone: opt(f, "tone"),
    voice_do: lines(f, "voice_do"), voice_dont: lines(f, "voice_dont"), visual_identity: opt(f, "visual_identity"),
    content_pillars: lines(f, "content_pillars").map((l) => {
      const [name, ...rest] = l.split(":");
      return { name: name.trim(), description: rest.join(":").trim() };
    }),
    key_messages: lines(f, "key_messages"), objectives: lines(f, "objectives"),
    creative_guidelines: opt(f, "creative_guidelines"), content_strategy: opt(f, "content_strategy"),
    production_requirements: opt(f, "production_requirements"), banned_terms: lines(f, "banned_terms"),
  };
}

export async function saveGuidelinesAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const back = `/brand-builder?brand=${brandId}`;
  const g = guidelineFields(f);
  try {
    await ctx.db(async (tx) => {
      await tx`update brand_guidelines set ${tx({ ...g, content_pillars: tx.json(g.content_pillars as never) } as never)} where brand_id = ${brandId}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "guidelines.edited", entityType: "brand", entityId: brandId });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, "Guidelines saved.");
}

export async function setGuidelineStatusAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const status = str(f, "status");
  const back = `/brand-builder?brand=${brandId}`;
  if (!["draft", "approved", "locked"].includes(status)) return fail(back, "Unknown status.");
  try {
    await ctx.db(async (tx) => {
      const patch =
        status === "approved" ? { status, approved_by: ctx.userId, approved_at: new Date(), locked_by: null, locked_at: null }
        : status === "locked" ? { status, locked_by: ctx.userId, locked_at: new Date() }
        : { status, locked_by: null, locked_at: null };
      const rows = await tx`update brand_guidelines set ${tx(patch as never)} where brand_id = ${brandId} returning id`;
      if (!rows.length) throw Object.assign(new Error(), { code: "42501" });
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: `guidelines.${status}`, entityType: "brand", entityId: brandId });
    });
  } catch (e) {
    return fail(back, dbMessage(e));
  }
  done(back, status === "locked" ? "Guidelines locked. They cannot be edited until unlocked." : status === "approved" ? "Guidelines approved." : "Guidelines returned to draft.");
}

/** AI-assisted onboarding: drafts guidelines from the brand profile and pasted materials. */
export async function generateGuidelinesAction(f: FormData) {
  const ctx = await requireContext();
  const brandId = str(f, "brand_id");
  const back = `/brand-builder?brand=${brandId}`;
  if (!ctx.can.edit) return fail(back, "You do not have permission to do that.");
  let message: string;
  try {
    const { brand, status } = await ctx.db(async (tx) => ({
      brand: await loadBrandContext(tx, brandId),
      status: (await tx`select status from brand_guidelines where brand_id = ${brandId}`)[0]?.status,
    }));
    if (status === "locked") return fail(back, "Guidelines are locked. Unlock them before regenerating.");
    const providers = await ctx.db((tx) => loadProviders(tx, ctx.org.id));
    const result = await callProvider(
      { org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: brandId, project_id: null, campaign_id: null, job_id: null },
      providers, (ctx.org.settings.routing_preference as RoutingPreference) ?? "quality",
      {
        capability: "text", task: "brand_guidelines", contentType: "brand_guidelines", contentLabel: "Brand guidelines", brand,
        brief: {
          title: "Brand guidelines", description: str(f, "materials") || brand.description || brand.name,
          audience: opt(f, "audience"), key_points: lines(f, "key_messages"), objective: opt(f, "objective"),
          language: brand.language, platforms: [],
        },
        context: {},
      },
      "brand_builder",
    );
    const g = result.json as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
    await ctx.db(async (tx) => {
      await tx`update brand_guidelines set ${tx({
        positioning: String(g.positioning ?? ""), personality: arr(g.personality), tone: String(g.tone ?? ""),
        voice_do: arr(g.voice_do), voice_dont: arr(g.voice_dont), visual_identity: String(g.visual_identity ?? ""),
        content_pillars: tx.json((Array.isArray(g.content_pillars) ? g.content_pillars : []) as never),
        key_messages: arr(g.key_messages), objectives: arr(g.objectives), creative_guidelines: String(g.creative_guidelines ?? ""),
        source: result.generative ? "ai" : "template", generated_by: result.providerName,
      } as never)} where brand_id = ${brandId}`;
      // Only fill what the user has not defined themselves.
      const palette = (Array.isArray(g.palette) ? g.palette : []).filter((p) => hex(String((p as { hex?: string }).hex ?? "")));
      if (!brand.palette.length && palette.length) await tx`update brands set palette = ${tx.json(palette as never)} where id = ${brandId}`;
      const typo = g.typography as { heading?: string; body?: string } | undefined;
      if (!brand.typography.heading && typo?.heading) await tx`update brands set typography = ${tx.json(typo as never)} where id = ${brandId}`;
      if (!brand.audiences.length) {
        for (const a of (Array.isArray(g.audiences) ? g.audiences : []) as { name?: string; description?: string; pains?: string[]; desires?: string[] }[]) {
          if (!a.name || a.name.startsWith("[TO CONFIRM")) continue;
          await tx`insert into audiences ${tx({ org_id: ctx.org.id, workspace_id: ctx.workspace.id, brand_id: brandId, name: a.name,
            description: a.description ?? null, pains: arr(a.pains), desires: arr(a.desires) } as never)}`;
        }
      }
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "guidelines.generated", entityType: "brand", entityId: brandId, detail: { provider: result.providerName } });
    });
    message = result.generative
      ? `Draft generated by ${result.providerName}. Review, edit and approve it.`
      : "Starter structure created by the built-in template engine (no AI provider is configured). Replace the placeholders with the brand's real guidelines.";
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail(back, dbMessage(e));
  }
  done(back, message);
}

/** Installs the INNERWORKS sample brand into the current workspace. */
export async function installSampleBrandAction() {
  const ctx = await requireContext();
  const s = innerworksSample;
  let id: string;
  try {
    id = await ctx.db(async (tx) => {
      const base = { org_id: ctx.org.id, workspace_id: ctx.workspace.id };
      const [b] = await tx`insert into brands ${tx({
        ...base, ...s.brand, slug: `${slugify(s.brand.name)}-${Date.now().toString(36).slice(-4)}`,
        palette: tx.json(s.brand.palette as never), typography: tx.json(s.brand.typography as never), is_sample: true, created_by: ctx.userId,
      } as never)} returning id`;
      const own = { ...base, brand_id: b.id };
      await tx`insert into brand_guidelines ${tx({ ...own, ...s.guidelines, content_pillars: tx.json(s.guidelines.content_pillars as never), source: "template", generated_by: "Sample brand profile" } as never)}`;
      for (const a of s.audiences) await tx`insert into audiences ${tx({ ...own, ...a } as never)}`;
      for (const a of s.socialAccounts) await tx`insert into social_accounts ${tx({ ...own, ...a } as never)}`;
      await tx`insert into projects ${tx({ ...own, name: "Documentary series", description: "Long-form engineering documentaries and their short-form cutdowns.", created_by: ctx.userId } as never)}`;
      await audit(tx, { orgId: ctx.org.id, workspaceId: ctx.workspace.id, userId: ctx.userId, action: "brand.sample_installed", entityType: "brand", entityId: b.id });
      return b.id as string;
    });
    // Brand-level workflow override (needs organization management rights; skipped otherwise).
    if (ctx.can.manageOrg) {
      await ctx.db((tx) => tx`insert into workflows ${tx({ org_id: ctx.org.id, brand_id: id, module: s.workflow.module, content_type: s.workflow.content_type,
        name: s.workflow.name, stages: tx.json(s.workflow.stages as never) } as never)}`);
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail("/brands", dbMessage(e));
  }
  revalidatePath("/brands");
  redirect(`/brands/${id}?ok=${encodeURIComponent("INNERWORKS sample brand installed. It is ordinary brand data: edit or delete it freely.")}`);
}

export async function archiveBrandAction(f: FormData) {
  const ctx = await requireContext();
  const id = str(f, "brand_id");
  try {
    await ctx.db((tx) => tx`update brands set status = ${str(f, "status") === "active" ? "active" : "archived"} where id = ${id}`);
  } catch (e) {
    return fail(`/brands/${id}`, dbMessage(e));
  }
  done(`/brands/${id}`, "Brand status updated.");
}


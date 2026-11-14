import type { Db } from "./db";
import type { BrandContext, ProviderRow } from "./ai/types";

/** Loads the identity of ONE brand. Every generation request is built from this and nothing else. */
export async function loadBrandContext(db: Db, brandId: string): Promise<BrandContext> {
  const [b] = await db`select * from brands where id = ${brandId}`;
  if (!b) throw new Error("Brand not found");
  const [g] = await db`select * from brand_guidelines where brand_id = ${brandId}`;
  const audiences = await db`select name, description, pains, desires from audiences where brand_id = ${brandId} order by created_at`;
  const products = await db`select name, description, features from products where brand_id = ${brandId} order by created_at`;
  return {
    id: b.id, name: b.name, tagline: b.tagline, description: b.description, industry: b.industry, market: b.market,
    website: b.website, language: b.primary_language, palette: b.palette ?? [], typography: b.typography ?? {},
    guidelines: g
      ? { status: g.status, positioning: g.positioning, personality: g.personality, tone: g.tone, voice_do: g.voice_do,
          voice_dont: g.voice_dont, visual_identity: g.visual_identity, content_pillars: g.content_pillars ?? [],
          key_messages: g.key_messages, objectives: g.objectives, creative_guidelines: g.creative_guidelines,
          content_strategy: g.content_strategy, production_requirements: g.production_requirements, banned_terms: g.banned_terms }
      : null,
    audiences: audiences as unknown as BrandContext["audiences"],
    products: products as unknown as BrandContext["products"],
  };
}

export async function loadProviders(db: Db, orgId: string): Promise<ProviderRow[]> {
  return (await db`select id, adapter, name, enabled, priority, capabilities, config, pricing, quality, speed
                   from ai_providers where org_id = ${orgId} order by priority, created_at`) as unknown as ProviderRow[];
}

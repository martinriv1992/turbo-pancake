// Adapter registry + router. To add a provider: write an Adapter, register it here.
// Organizations then add/remove/configure instances of it from the AI Providers panel
// (rows in ai_providers) without a rebuild.
import { anthropicAdapter } from "./adapters/anthropic";
import { localAdapter } from "./adapters/local";
import { costOf, type Adapter, type Capability, type ProviderRow } from "./types";

export const ADAPTERS: Record<string, Adapter> = {
  [localAdapter.key]: localAdapter,
  [anthropicAdapter.key]: anthropicAdapter,
};

export type RoutingPreference = "quality" | "cost" | "speed";
export type Candidate = { provider: ProviderRow; adapter: Adapter };

/** Typical usage per call, used to compare providers on price and to estimate jobs. */
export const TYPICAL_USAGE: Record<string, { input: number; output: number }> = {
  strategy: { input: 1500, output: 600 },
  script: { input: 2200, output: 1800 },
  concept: { input: 2000, output: 700 },
  final_text: { input: 2200, output: 3000 },
  document_body: { input: 2200, output: 6000 },
  platform_caption: { input: 1800, output: 400 },
  brand_guidelines: { input: 2500, output: 2500 },
  campaign_plan: { input: 2500, output: 2500 },
};

export function estimateCall(c: Candidate, capability: Capability, task?: string): number {
  if (capability === "text" || capability === "translation" || capability === "research") {
    const u = TYPICAL_USAGE[task ?? "final_text"] ?? TYPICAL_USAGE.final_text;
    return costOf(c.provider.pricing, { ...u, unit: "tokens" });
  }
  if (capability === "image" || capability === "image_edit") return costOf(c.provider.pricing, { input: 0, output: 1, unit: "images" });
  if (capability === "video" || capability === "voice" || capability === "audio") return costOf(c.provider.pricing, { input: 0, output: 30, unit: "seconds" });
  return costOf(c.provider.pricing, { input: 0, output: 1, unit: "renders" });
}

/**
 * Providers able to serve a capability right now, best first. The pipeline tries them in
 * order, so the second entry is the fallback when the first one fails.
 */
export function candidates(providers: ProviderRow[], capability: Capability, prefer: RoutingPreference = "quality", task?: string): Candidate[] {
  const list: Candidate[] = [];
  for (const provider of providers) {
    const adapter = ADAPTERS[provider.adapter];
    if (!adapter || !provider.enabled) continue;
    if (!adapter.capabilities.includes(capability) || !provider.capabilities.includes(capability)) continue;
    if (!adapter.availability(provider.config).ok) continue;
    list.push({ provider, adapter });
  }
  const price = (c: Candidate) => estimateCall(c, capability, task);
  return list.sort((a, b) => {
    const primary =
      prefer === "cost" ? price(a) - price(b)
      : prefer === "speed" ? b.provider.speed - a.provider.speed
      : b.provider.quality - a.provider.quality;
    return primary || a.provider.priority - b.provider.priority || price(a) - price(b);
  });
}

/** Why a capability has no provider — for honest UI messages. */
export function unavailableReason(providers: ProviderRow[], capability: Capability): string {
  const supporting = Object.values(ADAPTERS).filter((a) => a.capabilities.includes(capability));
  if (!supporting.length) return "No installed provider adapter supports this yet.";
  const rows = providers.filter((p) => supporting.some((a) => a.key === p.adapter) && p.capabilities.includes(capability));
  if (!rows.length) return `Add a provider that supports it (${supporting.map((a) => a.label).join(", ")}) in AI Providers.`;
  const enabled = rows.filter((p) => p.enabled);
  if (!enabled.length) return "The provider for this is disabled in AI Providers.";
  const why = ADAPTERS[enabled[0].adapter].availability(enabled[0].config);
  return why.ok ? "Unavailable." : why.reason;
}

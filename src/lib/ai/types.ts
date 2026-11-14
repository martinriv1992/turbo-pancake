// Provider-independent AI contract. The application only ever talks to this interface;
// adapters translate it to a concrete provider.

export const CAPABILITIES = [
  "text", "research", "translation", "image", "image_edit", "video", "voice", "audio", "3d",
  // Non-generative, deterministic renderers (brand layouts composed locally):
  "layout_image", "layout_video", "document",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  text: "Text generation",
  research: "Research",
  translation: "Translation",
  image: "Image generation",
  image_edit: "Image editing",
  video: "Video generation",
  voice: "Voice synthesis",
  audio: "Music & sound",
  "3d": "3D production",
  layout_image: "Brand layout images",
  layout_video: "Slide-based video (FFmpeg)",
  document: "Document rendering",
};

/** Everything a provider may know about the brand. Built once per job from the selected
 *  brand only, so one brand's identity can never leak into another brand's request. */
export type BrandContext = {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  industry?: string | null;
  market?: string | null;
  website?: string | null;
  language: string;
  palette: { name?: string; hex: string; role?: string }[];
  typography: { heading?: string; body?: string };
  guidelines: {
    status: string;
    positioning?: string | null;
    personality: string[];
    tone?: string | null;
    voice_do: string[];
    voice_dont: string[];
    visual_identity?: string | null;
    content_pillars: { name: string; description?: string }[];
    key_messages: string[];
    objectives: string[];
    creative_guidelines?: string | null;
    content_strategy?: string | null;
    production_requirements?: string | null;
    banned_terms: string[];
  } | null;
  audiences: { name: string; description?: string | null; pains: string[]; desires: string[] }[];
  products: { name: string; description?: string | null; features: string[] }[];
};

export type Brief = {
  title: string;
  description: string;
  objective?: string | null;
  key_points: string[];
  cta?: string | null;
  language: string;
  platforms: string[];
  format?: string | null;
  audience?: string | null;
};

export type Scene = { heading: string; narration: string; visual: string; duration: number };

export type TextTask =
  | "strategy" | "script" | "concept" | "final_text" | "document_body"
  | "brand_guidelines" | "campaign_plan" | "platform_caption";

export type ProviderRequest = {
  capability: Capability;
  task?: TextTask;
  contentType: string;
  contentLabel: string;
  brand: BrandContext;
  brief: Brief;
  /** Outputs of earlier pipeline stages. */
  context: { strategy?: string; script?: string; scenes?: Scene[]; concept?: Concept; body?: string; platform?: string };
};

export type Concept = { headline: string; subline: string; cta: string; visual: string; slides?: { headline: string; body: string }[] };

export type OutputFile = { data: Buffer; mime: string; ext: string; title: string; width?: number; height?: number; duration?: number };

export type ProviderResult = {
  text?: string;
  json?: unknown;
  files?: OutputFile[];
  model: string;
  usage: { input: number; output: number; unit: "tokens" | "images" | "seconds" | "renders" };
  notes?: string[];
};

export type ProviderConfig = { model?: string; api_key_env?: string; effort?: string };
export type Pricing = { input_per_mtok?: number; output_per_mtok?: number; per_image?: number; per_second?: number; per_render?: number };

export type ProviderRow = {
  id: string;
  adapter: string;
  name: string;
  enabled: boolean;
  priority: number;
  capabilities: string[];
  config: ProviderConfig;
  pricing: Pricing;
  quality: number;
  speed: number;
};

export interface Adapter {
  key: string;
  label: string;
  description: string;
  /** True when output comes from a generative model. False = deterministic renderer. */
  generative: boolean;
  capabilities: Capability[];
  defaultConfig: ProviderConfig;
  /** List prices in USD. Shown in the provider panel and editable there, because prices change. */
  defaultPricing: Pricing;
  pricingSource: string;
  defaultQuality: number;
  defaultSpeed: number;
  /** Whether this configured provider can run right now (e.g. its API key is present). */
  availability(config: ProviderConfig): { ok: true } | { ok: false; reason: string };
  run(req: ProviderRequest, config: ProviderConfig): Promise<ProviderResult>;
}

/** A provider error the worker may retry (rate limit, overload, network). */
export class RetryableProviderError extends Error {}

export function costOf(pricing: Pricing, usage: ProviderResult["usage"]): number {
  switch (usage.unit) {
    case "tokens":
      return (usage.input * (pricing.input_per_mtok ?? 0) + usage.output * (pricing.output_per_mtok ?? 0)) / 1_000_000;
    case "images":
      return usage.output * (pricing.per_image ?? 0);
    case "seconds":
      return usage.output * (pricing.per_second ?? 0);
    case "renders":
      return usage.output * (pricing.per_render ?? 0);
  }
}

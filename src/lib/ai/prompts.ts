// Prompt construction shared by every generative text adapter. The brand block is the
// single place where a brand's identity enters a request.
import type { BrandContext, ProviderRequest, TextTask } from "./types";

const list = (items: string[]) => items.filter(Boolean).map((i) => `- ${i}`).join("\n");

export function brandBlock(b: BrandContext): string {
  const g = b.guidelines;
  const lines = [
    `Brand: ${b.name}${b.tagline ? ` — "${b.tagline}"` : ""}`,
    b.description && `About: ${b.description}`,
    b.industry && `Industry: ${b.industry}`,
    b.market && `Market: ${b.market}`,
    b.website && `Website: ${b.website}`,
    b.palette.length && `Palette: ${b.palette.map((p) => `${p.name ?? p.role ?? "colour"} ${p.hex}`).join(", ")}`,
    (b.typography.heading || b.typography.body) && `Typography: headings ${b.typography.heading ?? "n/a"}, body ${b.typography.body ?? "n/a"}`,
  ];
  if (g) {
    lines.push(
      `Guidelines status: ${g.status}`,
      g.positioning && `Positioning: ${g.positioning}`,
      g.personality.length && `Personality: ${g.personality.join(", ")}`,
      g.tone && `Tone of voice: ${g.tone}`,
      g.voice_do.length && `Always:\n${list(g.voice_do)}`,
      g.voice_dont.length && `Never:\n${list(g.voice_dont)}`,
      g.banned_terms.length && `Banned terms (must not appear): ${g.banned_terms.join(", ")}`,
      g.visual_identity && `Visual identity: ${g.visual_identity}`,
      g.content_pillars.length && `Content pillars:\n${list(g.content_pillars.map((p) => `${p.name}${p.description ? `: ${p.description}` : ""}`))}`,
      g.key_messages.length && `Key messages:\n${list(g.key_messages)}`,
      g.objectives.length && `Marketing objectives:\n${list(g.objectives)}`,
      g.creative_guidelines && `Creative guidelines: ${g.creative_guidelines}`,
      g.content_strategy && `Content strategy: ${g.content_strategy}`,
      g.production_requirements && `Production requirements: ${g.production_requirements}`,
    );
  } else lines.push("No brand guidelines have been defined yet; stay neutral and factual.");
  if (b.audiences.length) lines.push(`Audiences:\n${list(b.audiences.map((a) => `${a.name}${a.description ? `: ${a.description}` : ""}`))}`);
  if (b.products.length) lines.push(`Products:\n${list(b.products.map((p) => `${p.name}${p.description ? `: ${p.description}` : ""}`))}`);
  return lines.filter(Boolean).join("\n");
}

export function systemPrompt(b: BrandContext): string {
  return `You produce content for exactly one brand. Everything you write must follow this brand's identity and guidelines; do not borrow voice, claims or facts from any other brand.

<brand>
${brandBlock(b)}
</brand>

Do not invent facts, statistics, prices, testimonials or product features that are not given in the brand information or the brief. If something needed is missing, write around it or mark it as [TO CONFIRM].`;
}

function briefBlock(r: ProviderRequest): string {
  const b = r.brief;
  return [
    `Content type: ${r.contentLabel}`,
    `Title: ${b.title}`,
    `What is wanted: ${b.description}`,
    b.objective && `Objective: ${b.objective}`,
    b.audience && `Target audience: ${b.audience}`,
    b.key_points.length && `Key points:\n${list(b.key_points)}`,
    b.cta && `Call to action: ${b.cta}`,
    b.platforms.length && `Platforms: ${b.platforms.join(", ")}`,
    b.format && `Format: ${b.format}`,
    `Output language: ${b.language}`,
  ].filter(Boolean).join("\n");
}

const str = { type: "string" } as const;
const strs = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }) as const;

export const SCHEMAS: Partial<Record<TextTask, Record<string, unknown>>> = {
  script: obj({
    title: str,
    scenes: { type: "array", items: obj({ heading: str, narration: str, visual: str, duration: { type: "number" } }) },
  }),
  concept: obj({
    headline: str, subline: str, cta: str, visual: str,
    slides: { type: "array", items: obj({ headline: str, body: str }) },
  }),
  brand_guidelines: obj({
    positioning: str, personality: strs, tone: str, voice_do: strs, voice_dont: strs, visual_identity: str,
    palette: { type: "array", items: obj({ name: str, hex: str, role: { type: "string", enum: ["primary", "accent", "neutral"] } }) },
    typography: obj({ heading: str, body: str }),
    audiences: { type: "array", items: obj({ name: str, description: str, pains: strs, desires: strs }) },
    content_pillars: { type: "array", items: obj({ name: str, description: str }) },
    key_messages: strs, objectives: strs, creative_guidelines: str,
  }),
  campaign_plan: obj({
    strategy: str,
    assets: { type: "array", items: obj({ content_type: str, title: str, description: str, day_offset: { type: "integer" } }) },
  }),
};

export function taskPrompt(r: ProviderRequest, extra?: { allowedTypes?: string[] }): string {
  const brief = `<brief>\n${briefBlock(r)}\n</brief>`;
  const strategy = r.context.strategy ? `\n<strategy>\n${r.context.strategy}\n</strategy>` : "";
  switch (r.task) {
    case "strategy":
      return `${brief}\n\nWrite a concise content strategy for this piece in Markdown: the angle, the audience insight it builds on, the single key message, the structure, and the call to action. Under 250 words.`;
    case "script":
      return `${brief}${strategy}\n\nWrite the script as a sequence of scenes. For each scene give a short heading, the narration (spoken or on-screen words), a visual description for production, and a duration in seconds. Match the pacing to the content type and platform.`;
    case "concept":
      return `${brief}${strategy}\n\nCreate the creative concept: a headline, a supporting subline, a short call to action, and a visual description for the designer or image model. If the content type is a carousel, also give 3-6 slides (headline and one-sentence body each); otherwise return an empty slides array.`;
    case "final_text":
      return `${brief}${strategy}\n\nWrite the final ${r.contentLabel} in Markdown, ready for review. Return only the content itself.`;
    case "document_body":
      return `${brief}${strategy}\n\nWrite the full body of this ${r.contentLabel} in Markdown with clear section headings. Do not include a cover title; it is added by the template. Return only the document body.`;
    case "platform_caption":
      return `${brief}\n\n<source>\n${r.context.body ?? ""}\n</source>\n\nAdapt the source into a post caption for ${r.context.platform}. Follow that platform's conventions for length, tone, line breaks and hashtags. Return only the caption.`;
    case "brand_guidelines":
      return `${brief}\n\nFrom the brand information and materials above, draft complete brand guidelines. Base every statement on what is provided; where you must infer, keep it conservative. Palette colours must be 6-digit hex values.`;
    case "campaign_plan":
      return `${brief}\n\nPlan a campaign. Write the strategy in Markdown (objective, audience, key message, phases), then list the assets to produce. Each asset's content_type must be one of: ${(extra?.allowedTypes ?? []).join(", ")}. day_offset is the publication day counted from the campaign start (0 = first day). Plan 4 to 8 assets that share the campaign's key message.`;
    default:
      return brief;
  }
}

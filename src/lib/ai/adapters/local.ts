// Built-in template engine. NOT an AI model: it composes deterministic drafts and brand
// layouts from the brief and the brand profile, so the whole production pipeline works
// with zero external services and zero cost. Everything it writes is labelled as a template draft.
import { FORMATS } from "@/lib/content/catalog";
import { renderDocumentHtml } from "@/lib/render/document";
import { renderSlidePng, type Slide } from "@/lib/render/layout";
import { renderSlideVideo } from "@/lib/render/video";
import type { Adapter, BrandContext, Brief, Concept, ProviderRequest, ProviderResult, Scene } from "../types";

const MODEL = "template-engine-v1";
const NOTE = "Template draft produced by the built-in engine without an AI model. Review and rewrite before use.";

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const points = (b: Brief) => (b.key_points.length ? b.key_points : sentences(b.description).slice(0, 4));
const tag = (s: string) => "#" + s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
const hashtags = (brand: BrandContext) =>
  [brand.name, ...(brand.guidelines?.content_pillars.map((p) => p.name) ?? [])].slice(0, 4).map(tag).filter((t) => t.length > 1);
const keyMessage = (r: ProviderRequest) => r.brief.objective || r.brand.guidelines?.key_messages[0] || points(r.brief)[0] || r.brief.title;
const cta = (r: ProviderRequest) => r.brief.cta || "Learn more";

function strategy(r: ProviderRequest): string {
  const g = r.brand.guidelines;
  const audience = r.brief.audience || r.brand.audiences[0]?.name || "[TO CONFIRM: target audience]";
  return [
    `## Angle`, sentences(r.brief.description)[0] ?? r.brief.title,
    `## Audience`, audience,
    `## Key message`, keyMessage(r),
    `## Tone`, g?.tone || "[TO CONFIRM: no tone of voice defined in the brand guidelines]",
    `## Structure`, points(r.brief).map((p, i) => `${i + 1}. ${p}`).join("\n"),
    `## Call to action`, cta(r),
    `---`, `_${NOTE}_`,
  ].join("\n\n");
}

function script(r: ProviderRequest): { title: string; scenes: Scene[] } {
  const scenes: Scene[] = [
    { heading: "Hook", narration: r.brief.title, visual: "Opening brand card with the title.", duration: 3 },
    ...points(r.brief).slice(0, 6).map((p, i) => ({ heading: `Point ${i + 1}`, narration: p, visual: "Brand card presenting this point.", duration: 4 })),
    { heading: "Call to action", narration: cta(r), visual: `Closing card with the ${r.brand.name} name and call to action.`, duration: 3 },
  ];
  return { title: r.brief.title, scenes };
}

function concept(r: ProviderRequest): Concept {
  const pts = points(r.brief);
  return {
    headline: r.brief.title,
    subline: pts[0] && pts[0] !== r.brief.title ? pts[0] : sentences(r.brief.description)[0] ?? "",
    cta: cta(r),
    visual: `Typographic brand layout using the ${r.brand.name} palette.`,
    slides: r.contentType === "carousel" ? pts.slice(0, 6).map((p, i) => ({ headline: `${i + 1}. ${p.split(/[:—–-]\s/)[0].slice(0, 60)}`, body: p })) : [],
  };
}

function finalText(r: ProviderRequest): string {
  const pts = points(r.brief);
  if (["social_caption", "ad_copy", "product_description"].includes(r.contentType)) {
    return [r.brief.title, r.brief.description, pts.map((p) => `• ${p}`).join("\n"), cta(r), hashtags(r.brand).join(" ")].filter(Boolean).join("\n\n");
  }
  return outline(r);
}

function outline(r: ProviderRequest): string {
  return [
    `## Overview`, r.brief.description,
    r.brief.objective ? `## Objective\n\n${r.brief.objective}` : "",
    ...points(r.brief).map((p) => `## ${p.split(/[.:]/)[0].slice(0, 70)}\n\n${p}\n\n_[Expand this section.]_`),
    `## Next step`, cta(r),
    `---`, `_${NOTE}_`,
  ].filter(Boolean).join("\n\n");
}

function platformCaption(r: ProviderRequest): string {
  const body = (r.context.body ?? r.brief.description).split(/\n{2,}/).filter((p) => !p.startsWith("#") && !p.startsWith("_") && p !== "---").slice(0, 3).join("\n\n");
  return [body, hashtags(r.brand).slice(0, 3).join(" ")].filter(Boolean).join("\n\n");
}

function hslHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function brandGuidelines(r: ProviderRequest) {
  const b = r.brand;
  const audience = r.brief.audience || "[TO CONFIRM: target audience]";
  const hue = [...b.name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
  return {
    positioning: `${b.name} is ${b.industry ? `a ${b.industry} brand` : "a brand"}${b.market ? ` serving ${b.market}` : ""} for ${audience}. ${b.description ?? ""}`.trim(),
    personality: [] as string[],
    tone: "Clear, direct and helpful. [Starter default — replace with the brand's real tone of voice.]",
    voice_do: ["Lead with the benefit to the audience", "Use plain language", "Back claims with specifics that have been confirmed"],
    voice_dont: ["Make claims that cannot be verified", "Use jargon the audience would not use"],
    visual_identity: "[TO CONFIRM] Describe logo usage, imagery style and layout principles.",
    palette: b.palette.length ? b.palette : [
      { name: "Primary (placeholder)", hex: hslHex(hue, 0.55, 0.22), role: "primary" },
      { name: "Accent (placeholder)", hex: hslHex((hue + 150) % 360, 0.85, 0.58), role: "accent" },
      { name: "Neutral", hex: "#f4f2ec", role: "neutral" },
    ],
    typography: { heading: b.typography.heading ?? "", body: b.typography.body ?? "" },
    audiences: [{ name: audience.slice(0, 80), description: r.brief.audience ?? "", pains: [], desires: [] }],
    content_pillars: [
      { name: "Product and offer", description: "What the brand sells and why it matters." },
      { name: "Education", description: "Helpful know-how for the audience." },
      { name: "Proof", description: "Results, customer stories and demonstrations." },
      { name: "Behind the scenes", description: "People, process and values." },
    ],
    key_messages: r.brief.key_points,
    objectives: r.brief.objective ? [r.brief.objective] : [],
    creative_guidelines: `[Starter structure generated from your inputs without AI analysis. ${NOTE}]`,
  };
}

function campaignPlan(r: ProviderRequest) {
  const base = `${r.brief.description} Key message: ${keyMessage(r)}.`;
  const a = (content_type: string, title: string, day_offset: number) => ({ content_type, title: `${r.brief.title} — ${title}`, description: base, day_offset });
  return {
    strategy: [
      `## Objective`, r.brief.objective || "[TO CONFIRM]",
      `## Key message`, keyMessage(r),
      `## Phases`, `1. Launch (day 0): hero creative, landing page copy and announcement.\n2. Sustain (days 2–4): carousel, short video and email follow-up.`,
      `---`, `_${NOTE}_`,
    ].join("\n\n"),
    assets: [
      a("ad_creative", "Hero creative", 0),
      a("social_caption", "Announcement post", 0),
      a("landing_page", "Landing page copy", 0),
      a("carousel", "Carousel", 2),
      a("reel", "Short video", 3),
      a("email", "Email", 4),
    ],
  };
}

const size = (format?: string | null, fallback = "1:1") => FORMATS[format ?? ""] ?? FORMATS[fallback];

async function layoutImage(r: ProviderRequest): Promise<ProviderResult> {
  const c = r.context.concept ?? concept(r);
  const { w, h } = size(r.brief.format);
  const slides: Slide[] = c.slides?.length
    ? [{ headline: c.headline, body: c.subline, index: `1/${c.slides.length + 2}` },
       ...c.slides.map((s, i) => ({ headline: s.headline, body: s.body, index: `${i + 2}/${c.slides!.length + 2}` })),
       { headline: c.cta, body: r.brand.tagline ?? "", cta: c.cta, index: `${c.slides.length + 2}/${c.slides.length + 2}` }]
    : [{ headline: c.headline, body: c.subline, cta: c.cta }];
  const files = [];
  for (let i = 0; i < slides.length; i++) {
    files.push({ data: await renderSlidePng(r.brand, slides[i], w, h), mime: "image/png", ext: "png", width: w, height: h,
      title: slides.length > 1 ? `${r.brief.title} — slide ${i + 1}` : r.brief.title });
  }
  return { files, model: MODEL, usage: { input: 0, output: files.length, unit: "renders" },
    notes: ["Typographic brand layout rendered locally; no generative imagery."] };
}

async function layoutVideo(r: ProviderRequest): Promise<ProviderResult> {
  const scenes = r.context.scenes?.length ? r.context.scenes : script(r).scenes;
  const full = size(r.brief.format, "9:16");
  const w = Math.round(full.w / 3) * 2, h = Math.round(full.h / 3) * 2; // 720p-class render
  const v = await renderSlideVideo(r.brand, scenes, w, h);
  const notes = ["Slide-based video rendered with FFmpeg from the script scenes. Silent: no voiceover or music."];
  if (v.scenesRendered < scenes.length) notes.push(`Only the first ${v.scenesRendered} of ${scenes.length} scenes were rendered.`);
  return { files: [{ data: v.data, mime: "video/mp4", ext: "mp4", title: r.brief.title, width: w, height: h, duration: v.duration }],
    model: MODEL, usage: { input: 0, output: 1, unit: "renders" }, notes };
}

export const localAdapter: Adapter = {
  key: "local-template",
  label: "Built-in template engine",
  description: "Deterministic drafts, brand layout images, slide videos (FFmpeg) and formatted documents. No AI, no cost, works offline.",
  generative: false,
  capabilities: ["text", "layout_image", "layout_video", "document"],
  defaultConfig: {},
  defaultPricing: {},
  pricingSource: "Runs locally; no provider charges.",
  defaultQuality: 1,
  defaultSpeed: 5,
  availability: () => ({ ok: true }),

  async run(r) {
    const usage = { input: 0, output: 1, unit: "renders" as const };
    if (r.capability === "layout_image") return layoutImage(r);
    if (r.capability === "layout_video") return layoutVideo(r);
    if (r.capability === "document") {
      const html = renderDocumentHtml(r.brand, r.brief.title, r.contentLabel, r.context.body ?? outline(r));
      return { files: [{ data: Buffer.from(html, "utf8"), mime: "text/html", ext: "html", title: r.brief.title }], model: MODEL, usage,
        notes: ["Print-ready HTML. Open it and use Print → Save as PDF for a PDF copy."] };
    }
    const notes = [NOTE];
    switch (r.task) {
      case "strategy": return { text: strategy(r), model: MODEL, usage, notes };
      case "script": return { json: script(r), model: MODEL, usage, notes };
      case "concept": return { json: concept(r), model: MODEL, usage, notes };
      case "document_body": return { text: outline(r), model: MODEL, usage, notes };
      case "platform_caption": return { text: platformCaption(r), model: MODEL, usage, notes: ["Not platform-optimised: generated without an AI model."] };
      case "brand_guidelines": return { json: brandGuidelines(r), model: MODEL, usage, notes };
      case "campaign_plan": return { json: campaignPlan(r), model: MODEL, usage, notes };
      default: return { text: finalText(r), model: MODEL, usage, notes };
    }
  },
};

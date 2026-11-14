// Universal content catalog. Adding a content type is a data change here — no pipeline code changes.
import type { Capability } from "@/lib/ai/types";

export type Module = "video" | "image" | "writing" | "audio" | "document";

export type ContentType = {
  key: string;
  label: string;
  module: Module;
  /** Capabilities that can produce the final asset, best first. The router uses the first one
   *  that has an enabled, available provider. Types whose only options are generative AI
   *  capabilities stay unavailable until such a provider is installed — nothing is faked. */
  produces: Capability[];
  formats?: string[];
};

export const MODULES: Record<Module, { label: string; studio: string; blurb: string }> = {
  video: { label: "Video", studio: "Video Studio", blurb: "Reels, shorts, ads, documentaries, explainers and animation." },
  image: { label: "Image", studio: "Image Studio", blurb: "Ad creatives, social graphics, carousels, banners and product imagery." },
  writing: { label: "Writing", studio: "Writing Studio", blurb: "Captions, articles, SEO, email, ad copy, scripts and proposals." },
  audio: { label: "Audio", studio: "Audio Studio", blurb: "Voiceovers, podcasts, narration, music and sound effects." },
  document: { label: "Document", studio: "Documents", blurb: "Proposals, presentations, catalogs, plans, reports and brochures." },
};

const V = ["9:16", "16:9", "1:1"];
const I = ["1:1", "4:5", "9:16", "16:9"];
const layoutVideo: Capability[] = ["video", "layout_video"];
const aiVideo: Capability[] = ["video"];
const layoutImage: Capability[] = ["image", "layout_image"];
const aiImage: Capability[] = ["image"];
const t = (key: string, label: string, module: Module, produces: Capability[], formats?: string[]): ContentType =>
  ({ key, label, module, produces, formats });

export const CONTENT_TYPES: ContentType[] = [
  // --- video
  t("reel", "Social media Reel", "video", layoutVideo, ["9:16"]),
  t("youtube_short", "YouTube Short", "video", layoutVideo, ["9:16"]),
  t("tiktok_video", "TikTok video", "video", layoutVideo, ["9:16"]),
  t("documentary", "Documentary", "video", layoutVideo, ["16:9", "9:16"]),
  t("product_ad", "Product advertisement", "video", layoutVideo, V),
  t("commercial", "Commercial", "video", layoutVideo, ["16:9", "9:16"]),
  t("tutorial", "Tutorial", "video", layoutVideo, V),
  t("explainer", "Explainer video", "video", layoutVideo, V),
  t("educational_video", "Educational video", "video", layoutVideo, V),
  t("corporate_video", "Corporate video", "video", layoutVideo, ["16:9"]),
  t("cinematic_story", "Cinematic storytelling", "video", aiVideo, ["16:9", "9:16"]),
  t("animation_2d", "2D animation", "video", aiVideo, V),
  t("animation_3d", "3D animation", "video", ["3d"], V),
  t("ai_video_sequence", "AI-generated video sequence", "video", aiVideo, V),
  t("ugc_ad", "UGC-style advertisement", "video", aiVideo, ["9:16"]),
  // --- image
  t("social_graphic", "Social media graphic", "image", layoutImage, I),
  t("ad_creative", "Advertising creative", "image", layoutImage, I),
  t("carousel", "Carousel", "image", layoutImage, ["1:1", "4:5"]),
  t("banner", "Banner", "image", layoutImage, ["16:9"]),
  t("poster", "Poster", "image", layoutImage, ["4:5", "9:16"]),
  t("thumbnail", "Thumbnail", "image", layoutImage, ["16:9"]),
  t("brand_graphic", "Brand graphic", "image", layoutImage, I),
  t("infographic", "Infographic", "image", aiImage, ["4:5", "9:16"]),
  t("product_photo", "Product photography", "image", aiImage, I),
  t("mockup", "Mockup", "image", aiImage, I),
  t("editorial_image", "Editorial image", "image", aiImage, I),
  t("illustration", "Illustration", "image", aiImage, I),
  t("ecommerce_image", "E-commerce imagery", "image", ["image", "image_edit"], ["1:1", "4:5"]),
  // --- writing
  ...(
    [
      ["social_caption", "Social media caption"],
      ["blog_article", "Blog article"],
      ["seo_content", "SEO content"],
      ["newsletter", "Newsletter"],
      ["ad_copy", "Advertising copy"],
      ["product_description", "Product description"],
      ["landing_page", "Landing page content"],
      ["video_script", "Script"],
      ["email", "Email"],
      ["commercial_proposal", "Commercial proposal"],
      ["educational_article", "Educational article"],
      ["technical_doc", "Technical documentation"],
      ["story", "Story"],
    ] as const
  ).map(([k, l]) => t(k, l, "writing", ["text"])),
  // --- audio
  t("voiceover", "Voiceover", "audio", ["voice"]),
  t("podcast", "Podcast", "audio", ["voice"]),
  t("audiobook", "Audiobook", "audio", ["voice"]),
  t("commercial_narration", "Commercial narration", "audio", ["voice"]),
  t("audio_ad", "Audio advertisement", "audio", ["voice"]),
  t("audio_summary", "Audio summary", "audio", ["voice"]),
  t("sound_effect", "Sound effect", "audio", ["audio"]),
  t("background_music", "Original background music", "audio", ["audio"]),
  // --- documents
  ...(
    [
      ["pdf_document", "Document"],
      ["presentation", "Presentation"],
      ["business_proposal", "Business proposal"],
      ["catalog", "Catalog"],
      ["marketing_plan", "Marketing plan"],
      ["report", "Report"],
      ["educational_material", "Educational material"],
      ["product_brochure", "Product brochure"],
      ["company_profile", "Company profile"],
    ] as const
  ).map(([k, l]) => t(k, l, "document", ["document"])),
];

export const contentType = (key: string) => CONTENT_TYPES.find((c) => c.key === key);
export const typesOf = (m: Module) => CONTENT_TYPES.filter((c) => c.module === m);

export const FORMATS: Record<string, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
};

export const PLATFORMS = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "pinterest", label: "Pinterest" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "other", label: "Other" },
] as const;

export const STAGE_LABELS: Record<string, string> = {
  brief: "Content brief",
  research: "Research",
  strategy: "Strategy",
  script: "Script",
  concept: "Concept",
  generation: "Generation",
  editing: "Editing",
  quality_control: "Quality control",
  human_approval: "Human approval",
  distribution: "Distribution",
  analytics: "Analytics",
};

export const LANGUAGES = [
  ["en", "English"], ["es", "Spanish"], ["pt", "Portuguese"], ["fr", "French"], ["de", "German"],
  ["it", "Italian"], ["nl", "Dutch"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ar", "Arabic"], ["hi", "Hindi"],
] as const;

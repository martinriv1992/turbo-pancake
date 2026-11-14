// Deterministic brand layouts: SVG composed from the brand palette, rasterised with sharp.
// This is typography-and-colour layout, not generative imagery.
import sharp from "sharp";
import { esc } from "@/lib/markdown";
import type { BrandContext } from "@/lib/ai/types";

const hexOk = (h?: string) => (h && /^#[0-9a-f]{6}$/i.test(h) ? h : null);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

export function brandColors(brand: Pick<BrandContext, "palette">) {
  const hexes = brand.palette.map((p) => hexOk(p.hex)).filter(Boolean) as string[];
  const byRole = (role: string) => hexOk(brand.palette.find((p) => p.role === role)?.hex);
  const bg = byRole("primary") ?? hexes[0] ?? "#15151c";
  const fg = lum(bg) > 0.4 ? "#111114" : "#ffffff";
  // The accent must be distinguishable from the background, otherwise fall back to the text colour.
  const accentCandidate = byRole("accent") ?? hexes.find((h) => h !== bg && contrast(h, bg) >= 1.6);
  const accent = accentCandidate && contrast(accentCandidate, bg) >= 1.6 ? accentCandidate : fg;
  const accentFg = lum(accent) > 0.4 ? "#111114" : "#ffffff";
  return { bg, fg, accent, accentFg };
}

// Approximate glyph widths (in ems of a bold sans) so wide capitals and narrow letters wrap correctly
// without a font-metrics dependency.
const glyph = (ch: string) =>
  /[WM@]/.test(ch) ? 1.05 : /[mw]/.test(ch) ? 0.95 : /[A-Z0-9]/.test(ch) ? 0.74 : /[iljtfrI.,:;!'|() ]/.test(ch) ? 0.38 : 0.63;
const measure = (s: string) => [...s].reduce((a, ch) => a + glyph(ch), 0);

/** Wraps to `maxEms` (line width divided by font size). */
function wrap(text: string, maxEms: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && measure(cur + " " + w) > maxEms) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/[\s.,;:!?]*$/, "") + "…";
    return cut;
  }
  return lines;
}

export type Slide = { kicker?: string; headline: string; body?: string; cta?: string; index?: string };

export function slideSvg(brand: BrandContext, slide: Slide, w: number, h: number): string {
  const c = brandColors(brand);
  const u = Math.min(w, h) / 1080; // scale unit
  const pad = 84 * u;
  // Font names are restricted to safe characters because they are interpolated into SVG attributes.
  const named = (brand.typography.heading ?? "").replace(/[^\w .-]/g, "").trim();
  const font = `${named ? `'${named}', ` : ""}'DejaVu Sans', 'Liberation Sans', Arial, sans-serif`;
  const headSize = (slide.headline.length > 70 ? 64 : slide.headline.length > 36 ? 80 : 104) * u;
  const headLines = wrap(slide.headline, (w - pad * 2) / headSize, 6);
  const bodySize = 38 * u;
  const bodyLines = slide.body ? wrap(slide.body, (w - pad * 2) / bodySize, h > w ? 8 : 4) : [];
  const blockH = headLines.length * headSize * 1.1 + (bodyLines.length ? 40 * u + bodyLines.length * bodySize * 1.4 : 0);
  let y = Math.max(pad + 150 * u, (h - blockH) / 2 + headSize * 0.8);

  const parts: string[] = [];
  parts.push(`<rect width="${w}" height="${h}" fill="${c.bg}"/>`);
  parts.push(`<circle cx="${w - 60 * u}" cy="${90 * u}" r="${260 * u}" fill="${c.accent}" opacity="0.16"/>`);
  parts.push(`<circle cx="${-40 * u}" cy="${h + 30 * u}" r="${320 * u}" fill="${c.accent}" opacity="0.10"/>`);
  parts.push(`<rect x="${pad}" y="${pad}" width="${56 * u}" height="${10 * u}" rx="${5 * u}" fill="${c.accent}"/>`);
  parts.push(`<text x="${pad}" y="${pad + 62 * u}" font-family="${font}" font-size="${30 * u}" font-weight="700" letter-spacing="${4 * u}" fill="${c.fg}">${esc(brand.name.toUpperCase())}</text>`);
  if (slide.index) parts.push(`<text x="${w - pad}" y="${pad + 62 * u}" text-anchor="end" font-family="${font}" font-size="${28 * u}" fill="${c.fg}" opacity="0.6">${esc(slide.index)}</text>`);
  if (slide.kicker) {
    parts.push(`<text x="${pad}" y="${y - headSize - 12 * u}" font-family="${font}" font-size="${30 * u}" font-weight="700" letter-spacing="${3 * u}" fill="${c.accent}">${esc(slide.kicker.toUpperCase().slice(0, 40))}</text>`);
  }
  for (const line of headLines) {
    parts.push(`<text x="${pad}" y="${y}" font-family="${font}" font-size="${headSize}" font-weight="800" fill="${c.fg}">${esc(line)}</text>`);
    y += headSize * 1.1;
  }
  y += 40 * u - headSize * 0.25;
  for (const line of bodyLines) {
    y += bodySize * 1.4;
    parts.push(`<text x="${pad}" y="${y}" font-family="${font}" font-size="${bodySize}" fill="${c.fg}" opacity="0.82">${esc(line)}</text>`);
  }
  if (slide.cta) {
    const label = slide.cta.slice(0, 34);
    const cw = measure(label) * 34 * u + 110 * u;
    const cy = h - pad - 84 * u;
    parts.push(`<rect x="${pad}" y="${cy}" width="${cw}" height="${84 * u}" rx="${42 * u}" fill="${c.accent}"/>`);
    parts.push(`<text x="${pad + cw / 2}" y="${cy + 54 * u}" text-anchor="middle" font-family="${font}" font-size="${34 * u}" font-weight="700" fill="${c.accentFg}">${esc(label)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export async function renderSlidePng(brand: BrandContext, slide: Slide, w: number, h: number): Promise<Buffer> {
  return sharp(Buffer.from(slideSvg(brand, slide, w, h))).png().toBuffer();
}

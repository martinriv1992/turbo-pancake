// Brand-formatted, print-ready HTML document (open in a browser → Print → Save as PDF).
import { esc, mdToHtml } from "@/lib/markdown";
import type { BrandContext } from "@/lib/ai/types";
import { brandColors } from "./layout";

export function renderDocumentHtml(brand: BrandContext, title: string, kind: string, markdown: string): string {
  const c = brandColors(brand);
  const safe = (f?: string) => (f ?? "").replace(/[^\w .-]/g, "").trim();
  const heading = safe(brand.typography.heading) ? `'${safe(brand.typography.heading)}', ` : "";
  const body = safe(brand.typography.body) ? `'${safe(brand.typography.body)}', ` : "";
  return `<!doctype html>
<html lang="${esc(brand.language)}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} — ${esc(brand.name)}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  body { font-family: ${body}Georgia, 'Times New Roman', serif; color: #1b1b1f; line-height: 1.6; max-width: 760px; margin: 0 auto; padding: 0 24px 64px; }
  .cover { background: ${c.bg}; color: ${c.fg}; margin: 0 -24px 40px; padding: 72px 48px 56px; }
  .cover .brand { font: 700 13px/1 ${heading}Helvetica, Arial, sans-serif; letter-spacing: .18em; text-transform: uppercase; }
  .cover .bar { width: 56px; height: 8px; border-radius: 4px; background: ${c.accent}; margin-bottom: 28px; }
  .cover h1 { font: 800 40px/1.12 ${heading}Helvetica, Arial, sans-serif; margin: 20px 0 10px; }
  .cover .kind { opacity: .75; font: 15px ${heading}Helvetica, Arial, sans-serif; }
  h1, h2, h3, h4 { font-family: ${heading}Helvetica, Arial, sans-serif; line-height: 1.25; margin: 1.8em 0 .5em; }
  h2 { font-size: 24px; padding-bottom: 6px; border-bottom: 2px solid ${c.bg}; }
  h3 { font-size: 18px; } li { margin: .25em 0; } hr { border: 0; border-top: 1px solid #ddd; margin: 2em 0; }
  @media print { .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<header class="cover"><div class="bar"></div><div class="brand">${esc(brand.name)}</div><h1>${esc(title)}</h1><div class="kind">${esc(kind)}</div></header>
${mdToHtml(markdown)}
</body></html>`;
}

// Extended browser checks: every navigation page, the sample brand, video / document /
// writing production, Campaign Studio, providers, budgets, emergency stop and metrics.
// Usage: BASE_URL=http://127.0.0.1:3000 node scripts/e2e-extended.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SHOTS = process.env.SHOTS_DIR ?? "test-results";
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
let passed = 0, failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}  [${page.url()}]`); await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, "-")}.png`, fullPage: true }); }
};
const shot = (name) => page.screenshot({ path: `${SHOTS}/x-${name}.png`, fullPage: true });
const see = (text, timeout = 90_000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });
const click = (name) => page.getByRole("button", { name, exact: true }).first().click();
const createJob = async (brandId, type, title, extra = async () => {}) => {
  await page.goto(`${BASE}/create?brand=${brandId}&type=${type}`);
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="description"]', "Explain how a four-stroke engine turns fuel into motion. Keep it accurate and visual.");
  await page.fill('textarea[name="key_points"]', "Intake: the piston draws in air and fuel\nCompression: the mixture is squeezed\nPower: the spark ignites it\nExhaust: burnt gas is pushed out");
  await page.fill('input[name="cta"]', "Watch the full documentary");
  await extra();
  await click("Start production");
  await page.waitForURL("**/jobs/*");
  return page.url();
};

// --- setup
await page.goto(`${BASE}/signup`);
await page.fill('input[name="name"]', "Extended Tester");
await page.fill('input[name="email"]', `ext-${stamp}@example.com`);
await page.fill('input[name="password"]', "demo-password-1");
await click("Create account");
await page.waitForURL("**/onboarding");
await page.fill('input[name="name"]', `Ext Org ${stamp}`);
await click("Create organization");
await see("is ready");

let brandId;
await check("install INNERWORKS sample brand", async () => {
  await page.goto(`${BASE}/brands`);
  await click("Install INNERWORKS");
  await page.waitForURL("**/brands/*");
  brandId = page.url().split("/brands/")[1].split("?")[0];
  await see("sample brand installed");
  await see("Documentary series");
  await shot("innerworks-brand");
});

await check("every navigation page renders", async () => {
  for (const p of ["/", "/workspaces", "/brands", "/brand-builder", `/brand-builder?brand=${brandId}`, "/studio/all", "/studio/video", "/studio/image", "/studio/writing",
    "/studio/audio", "/studio/document", "/campaigns", "/calendar", "/distribution", "/analytics", "/providers", "/automations", "/settings", "/create"]) {
    const res = await page.goto(BASE + p);
    if (res.status() !== 200) throw new Error(`${p} returned ${res.status()}`);
    await page.locator("h1").first().waitFor({ timeout: 15_000 });
  }
  if (pageErrors.length) throw new Error(pageErrors[0]);
});

await check("audio types are honestly unavailable without a voice provider", async () => {
  await page.goto(`${BASE}/create?brand=${brandId}&module=audio`);
  await see("Unavailable: needs a voice provider");
  await shot("audio-unavailable");
});

await check("autonomous mode can be selected; full automation needs typed confirmation", async () => {
  await page.goto(`${BASE}/automations`);
  await page.check('input[name="mode"][value="full_automation"]');
  await click("Save mode");
  await see("type ENABLE FULL AUTOMATION exactly");
  await page.check('input[name="mode"][value="autonomous_production"]');
  await click("Save mode");
  await see("Operating mode set to autonomous production");
});

let videoJob;
await check("video: documentary uses the brand workflow and renders an MP4", async () => {
  videoJob = await createJob(brandId, "documentary", "How a four-stroke engine works");
  await see("Review and approve");
  await see("INNERWORKS documentary workflow");
  await see("Editing");
  await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.readyState >= 1 && v.videoWidth > 0; }, null, { timeout: 60_000 });
  const size = await page.evaluate(() => { const v = document.querySelector("video"); return `${v.videoWidth}x${v.videoHeight} ${Math.round(v.duration)}s`; });
  console.log(`      video: ${size}`);
  if (!size.startsWith("1280x720")) throw new Error(`unexpected video size ${size}`);
  await shot("video-job");
});

await check("request changes → regenerate keeps versions", async () => {
  await page.fill('textarea[name="comment"]', "Tighten the hook.");
  await click("Request changes");
  await see("Changes requested");
  await click("Regenerate");
  await see("Review and approve");
  await see("Replaced by regeneration");
});

await check("document: brand-formatted HTML document", async () => {
  await createJob(brandId, "company_profile", "INNERWORKS company profile");
  await see("Review and approve");
  await page.locator("iframe").first().waitFor();
  await shot("document-job");
});

await check("writing: banned term is blocked by quality control, then fixed and re-run", async () => {
  await page.goto(`${BASE}/brand-builder?brand=${brandId}`);
  await page.fill('textarea[name="banned_terms"]', "revolutionary");
  await click("Save guidelines");
  await see("Guidelines saved");
  await createJob(brandId, "social_caption", "A revolutionary look inside engines");
  await see("Changes requested");
  await see('Banned term "revolutionary"');
  await shot("qc-blocked");
  await page.locator("summary", { hasText: "Edit" }).first().click();
  await page.fill('textarea[name="body"]', "A clear look inside the four-stroke engine.\n\nIntake, compression, power, exhaust.\n\nWatch the full documentary.");
  await click("Save changes");
  await see("Saved.");
  await click("Re-run quality control");
  await see("Review and approve");
  await click("Approve");
  await see("Prepare for publication");
});

await check("publication to a brand account, scheduled in the future, appears on the calendar", async () => {
  await page.locator('input[name="targets"]').first().check();
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  await page.fill('input[name="scheduled_at"]', future);
  await click("Prepare publication packages");
  await page.waitForURL("**/distribution?*");
  await see("Scheduled");
  await page.goto(`${BASE}/calendar?m=${future.slice(0, 7)}`);
  await see("A revolutionary look inside engines");
  await shot("calendar");
});

await check("publication: failed attempts are counted and retries run out", async () => {
  await page.goto(`${BASE}/distribution`);
  await page.getByRole("link", { name: "Open package" }).first().click();
  await page.waitForURL("**/distribution/*");
  for (let i = 1; i <= 3; i++) {
    await page.fill('input[name="detail"]', `Upload rejected (${i})`);
    await click("Record failure");
    await see(`(attempt ${i} of 3; ${i < 3 ? "ready to retry" : "no retries left"})`);
  }
  await see("Failed");
  await shot("publication-log");
});

let campaignUrl;
await check("campaign: plan, produce related assets, shared objective", async () => {
  await page.goto(`${BASE}/campaigns`);
  await page.fill('input[name="name"]', "Engine series launch");
  await page.fill('input[name="objective"]', "Launch the engine documentary series");
  await page.fill('input[name="key_message"]', "See how it works");
  await page.fill('textarea[name="description"]', "A four-part documentary series on engines.");
  await page.fill('input[name="start_date"]', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  await click("Plan campaign");
  await page.waitForURL("**/campaigns/*");
  campaignUrl = page.url().split("?")[0];
  await see("Campaign planned");
  await click("Produce assets");
  await see("6 production jobs started");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 6 && [...document.querySelectorAll("tbody tr")].every((r) => /Awaiting approval/.test(r.textContent)), null, { timeout: 120_000 });
  await shot("campaign");
});

await check("providers: Anthropic can be added and reports its missing key honestly", async () => {
  await page.goto(`${BASE}/providers`);
  await page.selectOption('select[name="adapter"]', "anthropic");
  await click("Add provider");
  await see("Anthropic Claude added");
  await see("Environment variable ANTHROPIC_API_KEY is not set");
  await shot("providers");
  // Not available → routing must still choose the built-in engine.
  await page.goto(`${BASE}/create?brand=${brandId}&type=blog_article`);
  await see("Built-in template engine");
});

await check("emergency stop holds new jobs; lifting it resumes them", async () => {
  await page.goto(`${BASE}/automations`);
  await click("Stop all production");
  await see("Emergency stop activated");
  const url = await createJob(brandId, "social_caption", "Held by the emergency stop");
  await page.waitForTimeout(6000);
  await page.reload();
  await see("Queued for production");
  await see("Emergency stop is active");
  await page.goto(`${BASE}/automations`);
  await click("Lift emergency stop");
  await see("Emergency stop lifted");
  await page.goto(url);
  await see("Review and approve");
});

await check("analytics: a recorded metric shows up in the dashboards", async () => {
  await page.goto(`${BASE}/analytics`);
  await page.selectOption('select[name="platform"]', "youtube");
  await page.selectOption('select[name="metric"]', "views");
  await page.fill('input[name="value"]', "12500");
  await page.fill('input[name="period_start"]', new Date().toISOString().slice(0, 10));
  await click("Record");
  await see("Metric recorded");
  await see("12,500");
  await page.goto(`${BASE}/analytics?scope=org`);
  await see("12,500");
  await shot("analytics");
});

await check("light theme and overview", async () => {
  await page.goto(`${BASE}/settings`);
  await click("Switch between light and dark");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.goto(BASE);
  await shot("overview-light");
  await page.goto(`${BASE}/settings`);
  await click("Switch between light and dark");
});

await check("no uncaught browser errors", async () => { if (pageErrors.length) throw new Error(pageErrors.join(" | ")); });

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

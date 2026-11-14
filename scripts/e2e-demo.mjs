// End-to-end demonstration in a real browser:
//   create organization → create brand → define identity → create project → generate an
//   asset → review and approve → prepare for publication → confirm publication.
// Usage: start the app, then `BASE_URL=http://127.0.0.1:3000 npm run test:e2e`
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // needs `playwright` installed (globally or as a dev dependency)
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SHOTS = process.env.SHOTS_DIR ?? "test-results";
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) });
let n = 0;
const step = async (name) => {
  n++;
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, "0")}-${name}.png`, fullPage: true });
  console.log(`ok  ${n}. ${name}`);
};
const expectText = async (text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 60_000 });
const click = (name) => page.getByRole("button", { name, exact: true }).first().click();

try {
  // 1. account + organization
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="name"]', "Demo Owner");
  await page.fill('input[name="email"]', `demo-${stamp}@example.com`);
  await page.fill('input[name="password"]', "demo-password-1");
  await click("Create account");
  await page.waitForURL("**/onboarding");
  await page.fill('input[name="name"]', `Demo Agency ${stamp}`);
  await click("Create organization");
  await expectText("is ready");
  await step("organization-created");

  // 2. brand
  await page.goto(`${BASE}/brands`);
  await page.fill('input[name="name"]', "Solaroma");
  await page.fill('input[name="tagline"]', "Sunlight, bottled.");
  await page.fill('input[name="industry"]', "Home fragrance");
  await page.fill('input[name="market"]', "United States and Canada");
  await page.fill('textarea[name="description"]', "Small-batch scented candles and diffusers made with natural wax and essential oils.");
  await page.fill('input[name="color_primary"]', "#1f3a2d");
  await page.fill('input[name="color_accent"]', "#f2b84b");
  await click("Create brand");
  await page.waitForURL("**/brand-builder?brand=*");
  const brandId = new URL(page.url()).searchParams.get("brand");
  await step("brand-created");

  // 3. identity: generate a starter draft, edit, approve, lock
  await page.fill('textarea[name="audience"]', "Design-conscious homeowners aged 28-45");
  await page.fill('textarea[name="key_messages"]', "Natural ingredients only\nHand-poured in small batches");
  await page.fill('textarea[name="objective"]', "Grow direct online sales");
  await click("Generate draft guidelines");
  await expectText("Starter structure created");
  await page.fill('textarea[name="tone"]', "Warm, calm and sensory. Short sentences. Never pushy.");
  await page.fill('textarea[name="banned_terms"]', "cheap");
  await click("Save guidelines");
  await expectText("Guidelines saved");
  await click("Approve");
  await expectText("Guidelines approved");
  await click("Lock");
  await expectText("Guidelines locked");
  await step("brand-identity-locked");

  // 4. content project
  await page.goto(`${BASE}/brands/${brandId}`);
  const projectForm = page.locator("form", { has: page.locator('input[name="kind"][value="project"]') });
  await projectForm.locator('input[name="name"]').fill("Autumn collection launch");
  await projectForm.locator('input[name="budget_usd"]').fill("250");
  await projectForm.getByRole("button", { name: "Add project" }).click();
  await expectText("Autumn collection launch");
  await step("project-created");

  // 5. generate an asset
  await page.goto(`${BASE}/create?brand=${brandId}&type=social_graphic`);
  await page.fill('input[name="title"]', "Autumn collection is here");
  await page.fill('textarea[name="description"]', "Announce the new autumn candle collection with three seasonal scents.");
  await page.fill('textarea[name="key_points"]', "Three new scents: Cedar Dusk, Spiced Pear, Amber Hearth\nNatural soy wax, 50 hour burn");
  await page.fill('input[name="cta"]', "Shop the collection");
  await page.selectOption('select[name="project_id"]', { label: "Autumn collection launch" });
  await page.check('input[name="platforms"][value="instagram"]');
  await step("create-content-form");
  await click("Start production");
  await page.waitForURL("**/jobs/*");
  const jobUrl = page.url();

  // Assisted mode: the pipeline pauses on the concept for human review.
  await expectText("Review the proposal");
  await step("proposal-review");
  await click("Continue production");
  await expectText("Review and approve");
  await page.waitForFunction(() => {
    const img = document.querySelector("img[alt='Autumn collection is here']");
    return img && img.complete && img.naturalWidth > 0;
  });
  await step("asset-generated");

  // 6. review and approve
  await click("Approve");
  await expectText("Prepare for publication");
  await step("approved");

  // 7. prepare for publication, then confirm
  await page.check('input[name="targets"][value="platform:instagram"]');
  await click("Prepare publication packages");
  await page.waitForURL("**/distribution?*");
  await expectText("1 publication package prepared");
  await step("publication-prepared");
  await page.getByRole("link", { name: "Open package" }).first().click();
  await page.waitForURL("**/distribution/*");
  await page.fill('input[name="external_url"]', "https://www.instagram.com/p/EXAMPLE/");
  await click("Confirm as published");
  await expectText("Publication confirmed");
  await step("publication-confirmed");

  await page.goto(BASE);
  await step("overview");
  console.log(`\nEnd-to-end demo passed. Job: ${jobUrl}\nScreenshots: ${SHOTS}/`);
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/FAILED.png`, fullPage: true });
  console.error(`\nFAILED at step ${n + 1}: ${e.message}\nURL: ${page.url()}\nSee ${SHOTS}/FAILED.png`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

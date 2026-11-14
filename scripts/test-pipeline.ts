// Verifies the production pipeline against a real database, without a browser:
// cost recording, budget enforcement, provider fallback, retry with backoff, cancellation.
// Usage: npm run test:pipeline
import { sql } from "../src/lib/db";
import { ADAPTERS } from "../src/lib/ai/registry";
import { RetryableProviderError, type Adapter } from "../src/lib/ai/types";
import { localAdapter } from "../src/lib/ai/adapters/local";
import { contentType } from "../src/lib/content/catalog";
import { initialStages, planJob, resolveWorkflow } from "../src/lib/jobs/plan";
import { loadProviders } from "../src/lib/brand-context";
import { runJob } from "../src/lib/jobs/pipeline";

let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, extra: unknown = "") => {
  cond ? passed++ : failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  → " + JSON.stringify(extra)}`);
};

// Test-only adapters, registered at runtime exactly like a real one would be.
let flakyCalls = 0;
const mk = (key: string, run: Adapter["run"]): Adapter => ({ ...localAdapter, key, label: key, generative: true, capabilities: ["text"], run });
ADAPTERS["test-paid"] = mk("test-paid", async (r, c) => ({ ...(await localAdapter.run(r, c)), model: "paid-1", usage: { input: 1_000_000, output: 500_000, unit: "tokens" } }));
ADAPTERS["test-broken"] = mk("test-broken", async () => { throw new Error("provider exploded"); });
ADAPTERS["test-flaky"] = mk("test-flaky", async (r, c) => {
  if (++flakyCalls === 1) throw new RetryableProviderError("rate limited");
  return localAdapter.run(r, c);
});

const tag = Math.random().toString(36).slice(2, 8);
const [user] = await sql`insert into auth.users (email) values (${`pipe-${tag}@test.local`}) returning id`;
await sql`insert into profiles (id, email) values (${user.id}, ${`pipe-${tag}@test.local`})`;
const [org] = await sql`insert into organizations (name, slug, created_by) values ('Pipe', ${"pipe-" + tag}, ${user.id}) returning id`;
const [ws] = await sql`insert into workspaces (org_id, name, automation_mode) values (${org.id}, 'W', 'autonomous_production') returning id`;
const [brand] = await sql`insert into brands (org_id, workspace_id, name, slug) values (${org.id}, ${ws.id}, 'B', 'b') returning id`;
const provider = async (adapter: string, quality: number, pricing = {}) =>
  (await sql`insert into ai_providers (org_id, adapter, name, capabilities, quality, pricing)
             values (${org.id}, ${adapter}, ${adapter}, ${ADAPTERS[adapter].capabilities as string[]}, ${quality}, ${sql.json(pricing)}) returning id`)[0].id;
await provider("local-template", 1);

async function job(typeKey = "social_caption", mode = "autonomous_production") {
  const type = contentType(typeKey)!;
  const wf = await resolveWorkflow(sql, { orgId: org.id, brandId: brand.id, module: type.module, contentType: type.key });
  const plan = planJob(type, wf, await loadProviders(sql, org.id), "quality");
  const brief = { title: "T", description: "A test brief. With two sentences.", key_points: ["One", "Two"], language: "en", platforms: [], format: type.formats?.[0] ?? null };
  const [j] = await sql`insert into content_jobs (org_id, workspace_id, brand_id, module, content_type, title, stages, input, operating_mode, estimated_cost_usd, status, attempts)
    values (${org.id}, ${ws.id}, ${brand.id}, ${type.module}, ${type.key}, 'T', ${sql.json(initialStages(plan) as never)}, ${sql.json({ brief } as never)}, ${mode}, ${plan.total}, 'running', 1) returning id`;
  return { id: j.id as string, plan };
}
const get = async (id: string) => (await sql`select * from content_jobs where id = ${id}`)[0];

// 1. free path
let j = await job();
ok("free job reaches human approval", (await runJob(j.id)) === "awaiting_approval");
ok("no cost recorded for the built-in engine", Number((await get(j.id)).actual_cost_usd) === 0);

// 2. assisted mode pauses on the proposal
j = await job("social_graphic", "assisted");
ok("assisted mode pauses after the concept", (await runJob(j.id)) === "paused_for_review");
await sql`update content_jobs set status = 'running' where id = ${j.id}`;
ok("…and continues to approval when resumed", (await runJob(j.id)) === "awaiting_approval");
ok("an image file was produced", (await sql`select 1 from images where job_id = ${j.id}`).length === 1);

// 3. paid provider: estimate, actual cost, cost rows
const paid = await provider("test-paid", 5, { input_per_mtok: 4, output_per_mtok: 20 });
j = await job();
ok("plan routes to the higher-quality provider and estimates a cost", j.plan.total > 0 && j.plan.usesAI, j.plan);
await runJob(j.id);
const paidJob = await get(j.id);
ok("actual cost = usage × configured price ($4 + $10)", Math.abs(Number(paidJob.actual_cost_usd) - 14) < 1e-6, paidJob.actual_cost_usd);
ok("a production_costs row was written", Number((await sql`select sum(amount_usd) s from production_costs where job_id = ${j.id}`)[0].s) === 14);
ok("provider usage logged with tokens", (await sql`select 1 from provider_usage where job_id = ${j.id} and input_units = 1000000 and status = 'ok'`).length === 1);

// 4. budget enforcement (organization, then brand)
await sql`update organizations set monthly_budget_usd = 14.001 where id = ${org.id}`;
j = await job();
ok("job is refused when the organization budget would be exceeded", (await runJob(j.id)) === "failed");
ok("the failure names the spending limit", /spending limit.*organization/i.test((await get(j.id)).errors.at(-1).message), (await get(j.id)).errors);
ok("nothing was spent on the refused job", Number((await get(j.id)).actual_cost_usd) === 0);
ok("the failure is in the audit log", (await sql`select 1 from audit_logs where entity_id = ${j.id} and action = 'job.failed'`).length === 1);
await sql`update organizations set monthly_budget_usd = null where id = ${org.id}`;
await sql`update brands set monthly_budget_usd = 1 where id = ${brand.id}`;
j = await job();
await runJob(j.id);
ok("brand budget is enforced too", /brand/.test((await get(j.id)).errors.at(-1)?.message ?? ""));
await sql`update brands set monthly_budget_usd = null where id = ${brand.id}`;
await sql`delete from ai_providers where id = ${paid}`;

// 5. fallback to the next provider
const broken = await provider("test-broken", 5);
j = await job();
ok("falls back to the next provider when the first fails", (await runJob(j.id)) === "awaiting_approval");
ok("the failed attempt is logged", (await sql`select 1 from provider_usage where job_id = ${j.id} and adapter = 'test-broken' and status = 'error'`).length === 1);
ok("the fallback provider did the work", (await get(j.id)).providers_used.every((p: { adapter: string }) => p.adapter === "local-template"));
await sql`delete from ai_providers where id = ${broken}`;

// 6. retryable error with no fallback → requeued with backoff, then succeeds
await sql`update ai_providers set enabled = false where org_id = ${org.id} and adapter = 'local-template'`;
await provider("test-flaky", 5);
await sql`update ai_providers set capabilities = '{text}' where org_id = ${org.id} and adapter = 'test-flaky'`;
j = await job();
ok("a retryable provider error requeues the job", (await runJob(j.id)) === "retrying");
const requeued = await get(j.id);
ok("…with a backoff delay and the error recorded", requeued.status === "queued" && new Date(requeued.run_after) > new Date() && /retrying/.test(requeued.errors.at(-1).message));
await sql`update content_jobs set status = 'running', attempts = 2 where id = ${j.id}`;
ok("the retry succeeds", (await runJob(j.id)) === "awaiting_approval");

// 7. no provider at all → clear failure
await sql`update ai_providers set enabled = false where org_id = ${org.id}`;
j = await job();
await runJob(j.id);
ok("with no provider the job fails with an explanation", /No provider available/.test((await get(j.id)).errors.at(-1).message));
await sql`update ai_providers set enabled = true where org_id = ${org.id} and adapter = 'local-template'`;

// 8. cancellation and emergency stop are honoured between stages
j = await job();
await sql`update content_jobs set cancel_requested = true where id = ${j.id}`;
ok("a cancelled job stops", (await runJob(j.id)) === "cancelled");
j = await job();
await sql`update organizations set emergency_stop = true where id = ${org.id}`;
ok("the emergency stop halts a running job and requeues it", (await runJob(j.id)) === "stopped" && (await get(j.id)).status === "queued");
await sql`update organizations set emergency_stop = false where id = ${org.id}`;

// 9. full automation: clean QC auto-approves in the enabling user's name; warnings do not
await sql`update workspaces set automation_mode = 'full_automation', full_automation_enabled_at = now(), full_automation_enabled_by = ${user.id} where id = ${ws.id}`;
j = await job("social_caption", "full_automation");
ok("full automation does NOT auto-approve content with QC warnings", (await runJob(j.id)) === "awaiting_approval");

await provider("test-paid", 5);
await sql`insert into brand_guidelines (org_id, workspace_id, brand_id, tone, status) values (${org.id}, ${ws.id}, ${brand.id}, 'calm', 'approved')`;
j = await job("social_caption", "full_automation");
ok("full automation auto-approves content that passes QC with no issues", (await runJob(j.id)) === "approved" && (await get(j.id)).status === "approved");
const [auto] = await sql`select decided_by, comment from approvals where job_id = ${j.id}`;
ok("…recorded in the name of whoever enabled it, and audited", auto?.decided_by === user.id && /full-automation/.test(auto.comment)
  && (await sql`select 1 from audit_logs where entity_id = ${j.id} and action = 'job.auto_approved'`).length === 1);

await sql`delete from organizations where id = ${org.id}`;
await sql`delete from auth.users where id = ${user.id}`;
await sql.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Verifies tenant isolation, role permissions and integrity guards against a real database.
// Usage: npm run test:rls   (creates throwaway users/orgs with a unique suffix, then deletes them)
import { asUser, sql } from "../src/lib/db";

const tag = Math.random().toString(36).slice(2, 8);
let passed = 0;
let failed = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  cond ? passed++ : failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
};
const denied = async (name: string, fn: () => Promise<unknown>) => {
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : (r as { count?: number })?.count ?? 1;
    ok(name, n === 0, `expected denial, but ${n} row(s) were affected`);
  } catch (e) {
    ok(name, true);
    void e;
  }
};

const user = async (name: string) => {
  const [u] = await sql`insert into auth.users (email) values (${`${name}-${tag}@rls.test`}) returning id`;
  await sql`insert into profiles (id, email) values (${u.id}, ${`${name}-${tag}@rls.test`})`;
  return u.id as string;
};

const [alice, bob, viewer, reviewer, producer, scoped, admin] = await Promise.all(
  ["alice", "bob", "viewer", "reviewer", "producer", "scoped", "admin"].map(user),
);

const [o1] = await asUser(alice, (tx) => tx`select * from app.create_organization(${"Org One " + tag})`);
const [o2] = await asUser(bob, (tx) => tx`select * from app.create_organization(${"Org Two " + tag})`);
const [ws1b] = await asUser(alice, (tx) => tx`insert into workspaces (org_id, name) values (${o1.org_id}, 'Second') returning id`);

await asUser(alice, async (tx) => {
  await tx`insert into memberships (org_id, user_id, role) values
    (${o1.org_id}, ${viewer}, 'viewer'), (${o1.org_id}, ${reviewer}, 'client_reviewer'),
    (${o1.org_id}, ${producer}, 'producer'), (${o1.org_id}, ${admin}, 'admin')`;
  await tx`insert into memberships (org_id, workspace_id, user_id, role) values (${o1.org_id}, ${ws1b.id}, ${scoped}, 'editor')`;
});

const mkBrand = (uid: string, org: string, ws: string, name: string) =>
  asUser(uid, (tx) => tx`insert into brands (org_id, workspace_id, name, slug) values (${org}, ${ws}, ${name}, ${name.toLowerCase()}) returning id`);

const [b1] = await mkBrand(alice, o1.org_id, o1.workspace_id, "Alpha");
const [b1b] = await mkBrand(alice, o1.org_id, ws1b.id, "Beta");
const [b2] = await mkBrand(bob, o2.org_id, o2.workspace_id, "Gamma");

// --- organization isolation
ok("owner sees own brands", (await asUser(alice, (tx) => tx`select id from brands`)).length === 2);
ok("other org sees none of them", (await asUser(bob, (tx) => tx`select id from brands where org_id = ${o1.org_id}`)).length === 0);
ok("other org cannot see the organization row", (await asUser(bob, (tx) => tx`select id from organizations where id = ${o1.org_id}`)).length === 0);
await denied("other org cannot insert a brand into this org", () => mkBrand(bob, o1.org_id, o1.workspace_id, "Intruder"));
await denied("other org cannot update a brand here", () => asUser(bob, (tx) => tx`update brands set name = 'x' where id = ${b1.id} returning id`));
await denied("other org cannot delete a brand here", () => asUser(bob, (tx) => tx`delete from brands where id = ${b1.id} returning id`));
await denied("no user context sees nothing", async () => {
  return sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    return tx`select id from brands`;
  });
});

// --- brand / workspace mixing is structurally impossible
await denied("brand cannot claim a workspace of another org", () => mkBrand(alice, o1.org_id, o2.workspace_id, "Mixed"));
await denied("job cannot reference a brand of another workspace", () =>
  asUser(alice, (tx) => tx`insert into content_jobs (org_id, workspace_id, brand_id, module, content_type, title)
    values (${o1.org_id}, ${o1.workspace_id}, ${b1b.id}, 'writing', 'social_caption', 't') returning id`));
await denied("job cannot reference a brand of another org", () =>
  asUser(alice, (tx) => tx`insert into content_jobs (org_id, workspace_id, brand_id, module, content_type, title)
    values (${o1.org_id}, ${o1.workspace_id}, ${b2.id}, 'writing', 'social_caption', 't') returning id`));

// --- workspace-scoped membership
const scopedBrands = await asUser(scoped, (tx) => tx`select id from brands`);
ok("workspace-scoped member sees only that workspace", scopedBrands.length === 1 && scopedBrands[0].id === b1b.id);
await denied("workspace-scoped member cannot write elsewhere", () => mkBrand(scoped, o1.org_id, o1.workspace_id, "Elsewhere"));
ok("workspace-scoped editor can write in own workspace", (await mkBrand(scoped, o1.org_id, ws1b.id, "Delta")).length === 1);

// --- roles
ok("viewer can read", (await asUser(viewer, (tx) => tx`select id from brands`)).length >= 2);
await denied("viewer cannot create a brand", () => mkBrand(viewer, o1.org_id, o1.workspace_id, "Nope"));
await denied("client reviewer cannot edit a brand", () => asUser(reviewer, (tx) => tx`update brands set name = 'x' where id = ${b1.id} returning id`));

const [job] = await asUser(producer, (tx) => tx`insert into content_jobs (org_id, workspace_id, brand_id, module, content_type, title)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, 'writing', 'social_caption', 'Job') returning id`);
ok("producer can create a job", !!job);
const approve = (uid: string, decidedBy = uid) => asUser(uid, (tx) => tx`insert into approvals (org_id, workspace_id, brand_id, job_id, decision, decided_by)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, ${job.id}, 'approved', ${decidedBy}) returning id`);
await sql`update content_jobs set status = 'awaiting_approval' where id = ${job.id}`;
await denied("producer cannot approve", () => approve(producer));
await denied("approval cannot be recorded in someone else's name", () => approve(reviewer, alice));
ok("client reviewer can approve", (await approve(reviewer)).length === 1);
ok("approval moves the job to approved", (await sql`select status from content_jobs where id = ${job.id}`)[0].status === "approved");
await denied("content that is not awaiting approval cannot be approved again", () => approve(alice));
await denied("approvals are immutable", () => asUser(alice, (tx) => tx`update approvals set decision = 'rejected' where job_id = ${job.id} returning id`));
await denied("users cannot write cost records", () => asUser(alice, (tx) => tx`insert into production_costs (org_id, workspace_id, brand_id, category, amount_usd)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, 'text', -100) returning id`));
await denied("non-manager cannot add an AI provider", () => asUser(producer, (tx) => tx`insert into ai_providers (org_id, adapter, name, capabilities)
  values (${o1.org_id}, 'anthropic', 'x', '{text}') returning id`));
await denied("non-manager cannot read the audit log", () => asUser(producer, (tx) => tx`select id from audit_logs where org_id = ${o1.org_id}`));
await denied("admin cannot grant the owner role", () => asUser(admin, (tx) => tx`insert into memberships (org_id, user_id, role) values (${o1.org_id}, ${bob}, 'owner') returning id`));
await denied("admin cannot remove the owner", () => asUser(admin, (tx) => tx`delete from memberships where org_id = ${o1.org_id} and user_id = ${alice} returning id`));
await denied("producer cannot add members", () => asUser(producer, (tx) => tx`insert into memberships (org_id, user_id, role) values (${o1.org_id}, ${bob}, 'viewer') returning id`));
await denied("organizations cannot be inserted directly", () => asUser(alice, (tx) => tx`insert into organizations (name, slug, created_by) values ('x', ${"x" + tag}, ${alice}) returning id`));

// --- brand guideline lock
const [g] = await asUser(producer, (tx) => tx`insert into brand_guidelines (org_id, workspace_id, brand_id, tone) values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, 'warm') returning id`);
await denied("producer cannot lock guidelines", () => asUser(producer, (tx) => tx`update brand_guidelines set status = 'locked' where id = ${g.id} returning id`));
await asUser(alice, (tx) => tx`update brand_guidelines set status = 'locked', locked_by = ${alice}, locked_at = now() where id = ${g.id}`);
await denied("locked guidelines cannot be edited", () => asUser(alice, (tx) => tx`update brand_guidelines set tone = 'cold' where id = ${g.id} returning id`));
ok("unlocking works for an approver", (await asUser(alice, (tx) => tx`update brand_guidelines set status = 'approved' where id = ${g.id} returning id`)).length === 1);

// --- publication integrity
const pub = (status: string) => asUser(alice, (tx) => tx`insert into publication_jobs (org_id, workspace_id, brand_id, job_id, platform, status)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, ${job.id}, 'instagram', ${status}) returning id`);
const [job2] = await asUser(producer, (tx) => tx`insert into content_jobs (org_id, workspace_id, brand_id, module, content_type, title)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, 'writing', 'social_caption', 'Unapproved') returning id`);
await denied("unapproved content cannot be scheduled", () => asUser(alice, (tx) => tx`insert into publication_jobs (org_id, workspace_id, brand_id, job_id, platform, status)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, ${job2.id}, 'instagram', 'scheduled') returning id`));
const [p] = await pub("ready_manual");
await denied("cannot mark published without a confirmed result", () => asUser(alice, (tx) => tx`update publication_jobs set status = 'published' where id = ${p.id} returning id`));
await denied("a confirmation needs a URL or external id", () => asUser(alice, (tx) => tx`insert into publication_results (org_id, workspace_id, brand_id, publication_job_id, status, confirmation, confirmed_by)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, ${p.id}, 'confirmed', 'manual', ${alice}) returning id`));
await denied("editor-level user without publish permission cannot confirm", () => asUser(producer, (tx) => tx`insert into publication_results (org_id, workspace_id, brand_id, publication_job_id, status, confirmation, external_url, confirmed_by)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, ${p.id}, 'confirmed', 'manual', 'https://example.com/p/1', ${producer}) returning id`));
await asUser(alice, (tx) => tx`insert into publication_results (org_id, workspace_id, brand_id, publication_job_id, status, confirmation, external_url, confirmed_by)
  values (${o1.org_id}, ${o1.workspace_id}, ${b1.id}, ${p.id}, 'confirmed', 'manual', 'https://example.com/p/1', ${alice})`);
ok("published after confirmation", (await asUser(alice, (tx) => tx`update publication_jobs set status = 'published' where id = ${p.id} returning id`)).length === 1);

// --- automation guard
await denied("full automation needs explicit activation metadata", () => asUser(alice, (tx) => tx`update workspaces set automation_mode = 'full_automation' where id = ${o1.workspace_id} returning id`));

// cleanup
await sql`delete from organizations where id in (${o1.org_id}, ${o2.org_id})`;
await sql`delete from auth.users where email like ${"%-" + tag + "@rls.test"}`;
await sql.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

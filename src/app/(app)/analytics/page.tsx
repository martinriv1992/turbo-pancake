import Link from "next/link";
import { AutoSubmitSelect } from "@/components/client";
import { Button, Card, Field, Input, money, Notice, PageHeader, Select, Stat, Table } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { contentType, MODULES, PLATFORMS } from "@/lib/content/catalog";
import { deleteMetricAction, recordMetricAction } from "@/server/actions/admin";

const METRICS = ["views", "reach", "engagement", "retention", "watch_time", "clicks", "shares", "followers", "conversions", "revenue"];
const n = (v: unknown) => Number(v ?? 0);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope = "workspace" } = await searchParams;
  const ctx = await requireContext();
  const [kind, scopeId] = scope.split(":");

  const d = await ctx.db(async (tx) => {
    // One filter for every query on this page. RLS still limits what "organization" can see.
    const where = (alias: string) =>
      kind === "org" ? tx`${tx(alias)}.org_id = ${ctx.org.id}`
      : kind === "brand" ? tx`${tx(alias)}.brand_id = ${scopeId}`
      : kind === "campaign" ? tx`${tx(alias)}.campaign_id = ${scopeId}`
      : tx`${tx(alias)}.workspace_id = ${ctx.workspace.id}`;
    return {
      brands: await tx`select id, name from brands where workspace_id = ${ctx.workspace.id} order by name`,
      campaigns: await tx`select id, name from campaigns where workspace_id = ${ctx.workspace.id} order by created_at desc`,
      jobs: await tx`select status, module, count(*)::int as n from content_jobs j where ${where("j")} group by status, module`,
      costs: await tx`select category, sum(amount_usd) as total from production_costs c where ${where("c")} group by category order by total desc`,
      usage: kind === "campaign" ? [] : await tx`
        select adapter, coalesce(model, '—') as model, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors,
               sum(cost_usd) as cost, sum(input_units + output_units) filter (where unit = 'tokens') as tokens
        from provider_usage u where ${where("u")} group by adapter, model order by calls desc`,
      pubs: await tx`select status, count(*)::int as n from publication_jobs p where ${where("p")} group by status`,
      totals: await tx`select platform, metric, sum(value) as total from analytics a where ${where("a")} group by platform, metric order by platform, metric`,
      assets: await tx`
        select j.id, j.title, j.content_type, sum(a.value) filter (where a.metric = 'views') as views,
               sum(a.value) filter (where a.metric = 'engagement') as engagement, sum(a.value) filter (where a.metric = 'clicks') as clicks
        from analytics a join content_jobs j on j.id = a.job_id where ${where("a")} group by j.id order by views desc nulls last limit 10`,
      rows: await tx`
        select a.id, a.platform, a.metric, a.value, a.period_start, a.period_end, a.source, b.name as brand
        from analytics a join brands b on b.id = a.brand_id where ${where("a")} order by a.created_at desc limit 30`,
      published: await tx`
        select p.id, p.platform, j.title from publication_jobs p join content_jobs j on j.id = p.job_id
        where p.workspace_id = ${ctx.workspace.id} and p.status = 'published' order by p.updated_at desc limit 50`,
    };
  });

  const byStatus = (s: string[]) => d.jobs.filter((j) => s.includes(j.status)).reduce((a, j) => a + j.n, 0);
  const total = d.jobs.reduce((a, j) => a + j.n, 0);
  const approved = byStatus(["approved"]), failed = byStatus(["failed"]), decided = approved + byStatus(["rejected", "changes_requested"]);
  const cost = d.costs.reduce((a, c) => a + n(c.total), 0);
  const published = d.pubs.find((p) => p.status === "published")?.n ?? 0;
  const metric = (m: string) => d.totals.filter((t) => t.metric === m).reduce((a, t) => a + n(t.total), 0);
  const platforms = [...new Set(d.totals.map((t) => t.platform))];

  // Recommendations are plain rules over the numbers above — no model is involved.
  const insights: string[] = [];
  if (!total) insights.push("Nothing has been produced in this scope yet.");
  if (total >= 3 && failed / total > 0.2) insights.push(`${Math.round((failed / total) * 100)}% of jobs failed. Check provider availability and budgets in AI Providers and Automations.`);
  if (decided >= 3 && approved / decided < 0.6) insights.push(`Only ${Math.round((approved / decided) * 100)}% of reviewed content was approved first time. Tightening the brand guidelines usually raises this.`);
  if (approved > 0 && cost > 0) insights.push(`Each approved asset has cost ${money(cost / approved)} on average.`);
  if (published > 0 && !d.totals.length) insights.push("Posts have been published but no performance data is recorded. Add metrics below to compare platforms.");
  if (approved > published + (d.pubs.find((p) => p.status === "scheduled")?.n ?? 0) + (d.pubs.find((p) => p.status === "ready_manual")?.n ?? 0)) insights.push("Some approved content has not been prepared for publication. See the Content Calendar.");
  const rate = platforms.map((p) => {
    const v = n(d.totals.find((t) => t.platform === p && t.metric === "views")?.total), e = n(d.totals.find((t) => t.platform === p && t.metric === "engagement")?.total);
    return { p, rate: v > 0 ? e / v : 0, v };
  }).filter((r) => r.v > 0).sort((a, b) => b.rate - a.rate);
  if (rate.length > 1) insights.push(`${rate[0].p} has the highest engagement per view (${(rate[0].rate * 100).toFixed(1)}%), ${rate.at(-1)!.p} the lowest (${(rate.at(-1)!.rate * 100).toFixed(1)}%).`);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Production, cost and performance — by organization, workspace, brand or campaign."
        actions={
          <form>
            <AutoSubmitSelect name="scope" defaultValue={scope} aria-label="Scope" className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <option value="org">Organization: {ctx.org.name}</option>
              <option value="workspace">Workspace: {ctx.workspace.name}</option>
              <optgroup label="Brand">{d.brands.map((b) => <option key={b.id} value={`brand:${b.id}`}>{b.name}</option>)}</optgroup>
              <optgroup label="Campaign">{d.campaigns.map((c) => <option key={c.id} value={`campaign:${c.id}`}>{c.name}</option>)}</optgroup>
            </AutoSubmitSelect>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Jobs" value={total} hint={`${approved} approved · ${failed} failed`} />
        <Stat label="First-pass approval" value={decided ? `${Math.round((approved / decided) * 100)}%` : "—"} hint={`${decided} reviewed`} />
        <Stat label="Production cost" value={money(cost)} hint={approved && cost ? `${money(cost / approved)} per approved asset` : "All time"} />
        <Stat label="Published" value={published} hint="Confirmed publications" />
        <Stat label="Views" value={metric("views").toLocaleString("en-US")} />
        <Stat label="Engagement" value={metric("engagement").toLocaleString("en-US")} />
        <Stat label="Clicks" value={metric("clicks").toLocaleString("en-US")} />
        <Stat label="Revenue" value={money(metric("revenue"))} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Recommendations" action={<span className="text-xs text-muted">Rules computed from your data, not AI-generated</span>}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">{(insights.length ? insights : ["Nothing stands out in the current numbers."]).map((i) => <li key={i}>{i}</li>)}</ul>
          </Card>

          <Card title="Platform performance">
            {d.totals.length ? (
              <Table head={["Platform", ...METRICS.map((m) => m.replace("_", " "))]}>
                {platforms.map((p) => (
                  <tr key={p}>
                    <td className="font-medium capitalize">{p}</td>
                    {METRICS.map((m) => <td key={m} className="tabular-nums text-muted">{d.totals.find((t) => t.platform === p && t.metric === m) ? n(d.totals.find((t) => t.platform === p && t.metric === m)!.total).toLocaleString("en-US") : "—"}</td>)}
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">No performance data in this scope. Platform APIs are not connected yet, so metrics are entered manually below.</p>}
          </Card>

          {d.assets.length > 0 && (
            <Card title="Top assets">
              <Table head={["Asset", "Views", "Engagement", "Clicks"]}>
                {d.assets.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/jobs/${a.id}`} className="font-medium hover:text-accent">{a.title}</Link><div className="text-xs text-muted">{contentType(a.content_type)?.label}</div></td>
                    {[a.views, a.engagement, a.clicks].map((v, i) => <td key={i} className="tabular-nums">{v == null ? "—" : n(v).toLocaleString("en-US")}</td>)}
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          <Card title="AI and provider usage">
            {d.usage.length ? (
              <Table head={["Provider", "Model", "Calls", "Errors", "Tokens", "Cost"]}>
                {d.usage.map((u, i) => (
                  <tr key={i}><td className="font-medium">{u.adapter}</td><td className="text-muted">{u.model}</td><td className="tabular-nums">{u.calls}</td>
                    <td className={`tabular-nums ${u.errors ? "text-danger" : "text-muted"}`}>{u.errors}</td><td className="tabular-nums text-muted">{u.tokens ? n(u.tokens).toLocaleString("en-US") : "—"}</td><td className="tabular-nums">{money(u.cost)}</td></tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">{kind === "campaign" ? "Provider usage is tracked per job; see the campaign's assets." : "No provider calls yet."}</p>}
          </Card>

          {ctx.can.edit && d.rows.length > 0 && (
            <Card title="Recorded metrics">
              <Table head={["Brand", "Platform", "Metric", "Value", "Period", ""]}>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.brand}</td><td className="capitalize">{r.platform}</td><td>{String(r.metric).replace("_", " ")}</td><td className="tabular-nums">{n(r.value).toLocaleString("en-US")}</td>
                    <td className="whitespace-nowrap text-muted">{new Date(r.period_start).toISOString().slice(0, 10)} → {new Date(r.period_end).toISOString().slice(0, 10)}</td>
                    <td className="text-right"><form action={deleteMetricAction}><input type="hidden" name="id" value={r.id} /><button className="cursor-pointer text-xs text-muted hover:text-danger">Remove</button></form></td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Production by format">
            <ul className="space-y-2 text-sm">
              {Object.entries(MODULES).map(([k, m]) => {
                const count = d.jobs.filter((j) => j.module === k).reduce((a, j) => a + j.n, 0);
                return (
                  <li key={k}>
                    <div className="flex justify-between"><span>{m.label}</span><span className="tabular-nums text-muted">{count}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${total ? (count / total) * 100 : 0}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Cost by category">
            {d.costs.length ? (
              <ul className="space-y-1.5 text-sm">{d.costs.map((c) => <li key={c.category} className="flex justify-between"><span className="capitalize">{c.category}</span><span className="tabular-nums">{money(c.total)}</span></li>)}</ul>
            ) : <p className="text-sm text-muted">No costs recorded. The built-in template engine is free; AI providers are charged per call.</p>}
          </Card>

          {ctx.can.edit && (
            <Card title="Record a metric">
              <form action={recordMetricAction} className="space-y-3">
                <Field label="Published post" hint="Optional: links the metric to an asset and campaign.">
                  <Select name="publication_job_id"><option value="">Not tied to a post</option>{d.published.map((p) => <option key={p.id} value={p.id}>{p.platform} · {p.title}</option>)}</Select>
                </Field>
                <Field label="Brand"><Select name="brand_id" required>{d.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Platform"><Select name="platform">{PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></Field>
                  <Field label="Metric"><Select name="metric">{METRICS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</Select></Field>
                  <Field label="Value"><Input name="value" type="number" min="0" step="any" required /></Field>
                  <Field label="From"><Input name="period_start" type="date" required /></Field>
                </div>
                <Button variant="secondary">Record</Button>
              </form>
              <div className="mt-4"><Notice>Automatic metric import needs each platform's analytics API to be connected. Until then, figures here are whatever you enter.</Notice></div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

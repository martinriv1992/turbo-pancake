import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/client";
import { Badge, BrandChip, Button, Card, Markdown, money, Notice, PageHeader, Select, StatusBadge, Table } from "@/components/ui";
import { loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { contentType } from "@/lib/content/catalog";
import { planJob, resolveWorkflow } from "@/lib/jobs/plan";
import type { RoutingPreference } from "@/lib/ai/registry";
import { produceCampaignAction, setCampaignStatusAction } from "@/server/actions/campaigns";

type Item = { content_type: string; title: string; description: string; day_offset: number; job_id?: string; skipped?: string };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => {
    const [c] = await tx`select c.*, b.name as brand, b.palette from campaigns c join brands b on b.id = c.brand_id where c.id = ${id}`;
    if (!c) return null;
    const providers = await loadProviders(tx, ctx.org.id);
    const estimates: Record<number, { total: number; blocked?: string }> = {};
    const plan = c.plan as Item[];
    for (let i = 0; i < plan.length; i++) {
      const t = contentType(plan[i].content_type);
      if (!t) continue;
      const p = planJob(t, await resolveWorkflow(tx, { orgId: ctx.org.id, brandId: c.brand_id, module: t.module, contentType: t.key }), providers,
        (ctx.org.settings.routing_preference as RoutingPreference) ?? "quality");
      estimates[i] = { total: p.total, blocked: p.blocked };
    }
    return {
      c, plan, estimates,
      jobs: await tx`select id, status, actual_cost_usd from content_jobs where campaign_id = ${id}`,
      pubs: await tx`select p.id, p.platform, p.status, p.scheduled_at, j.title from publication_jobs p join content_jobs j on j.id = p.job_id where p.campaign_id = ${id} order by p.scheduled_at nulls last`,
      spent: (await tx`select coalesce(sum(amount_usd), 0) as v from production_costs where campaign_id = ${id}`)[0].v,
    };
  });
  if (!d) notFound();
  const { c, plan } = d;
  const job = (jid?: string) => d.jobs.find((j) => j.id === jid);
  const pending = plan.filter((i) => !i.job_id);
  const pendingCost = plan.reduce((sum, item, i) => sum + (!item.job_id && !d.estimates[i]?.blocked ? d.estimates[i]?.total ?? 0 : 0), 0);
  const working = d.jobs.some((j) => j.status === "queued" || j.status === "running");
  const day = (offset: number) => c.start_date ? new Date(new Date(c.start_date).getTime() + offset * 86400000).toISOString().slice(0, 10) : `Day ${offset + 1}`;

  return (
    <>
      {working && <AutoRefresh everyMs={3000} />}
      <PageHeader
        title={c.name}
        subtitle={<span className="flex flex-wrap items-center gap-3"><BrandChip name={c.brand} palette={c.palette} /><span>{c.objective}</span></span>}
        actions={<StatusBadge status={c.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Campaign assets" action={<span className="text-xs text-muted">Every asset inherits the campaign objective and key message</span>}>
            <Table head={["Asset", "Planned date", "Estimate", "Status"]}>
              {plan.map((item, i) => {
                const j = job(item.job_id);
                const e = d.estimates[i];
                return (
                  <tr key={i}>
                    <td>
                      {j ? <Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">{item.title}</Link> : <span className="font-medium">{item.title}</span>}
                      <div className="text-xs text-muted">{contentType(item.content_type)?.label}</div>
                      {!j && (item.skipped || e?.blocked) && <div className="mt-1 text-xs text-danger">{item.skipped ?? e?.blocked}</div>}
                    </td>
                    <td className="whitespace-nowrap text-muted">{day(item.day_offset)}</td>
                    <td className="tabular-nums">{j ? money(j.actual_cost_usd) : money(e?.total ?? 0)}</td>
                    <td>{j ? <StatusBadge status={j.status} /> : e?.blocked ? <Badge tone="danger">No provider</Badge> : <Badge>Not started</Badge>}</td>
                  </tr>
                );
              })}
            </Table>
            {!plan.length && <p className="text-sm text-muted">The plan has no assets.</p>}
          </Card>

          {ctx.can.edit && pending.length > 0 && (
            <Card title="Produce the campaign">
              <form action={produceCampaignAction} className="flex flex-wrap items-center justify-between gap-3">
                <input type="hidden" name="campaign_id" value={id} />
                <div className="text-sm">
                  Starts {pending.length} production job{pending.length === 1 ? "" : "s"} · estimated <strong>{money(pendingCost)}</strong>
                  {pendingCost > 0 && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="confirm_cost" required /> I confirm this estimated cost.</label>}
                </div>
                <Button>Produce assets</Button>
              </form>
              <p className="mt-3 text-xs text-muted">Each asset then goes through its own pipeline and approval. Assets without an available provider are skipped and say why.</p>
            </Card>
          )}

          {c.strategy && (
            <Card title="Campaign strategy" action={<span className="text-xs text-muted">Drafted by {c.plan_provider}</span>}>
              <Markdown>{c.strategy}</Markdown>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <dl className="space-y-2 text-sm [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted [&_dd]:text-right">
              <div><dt>Key message</dt><dd>{c.key_message ?? "—"}</dd></div>
              <div><dt>Dates</dt><dd>{c.start_date ? new Date(c.start_date).toISOString().slice(0, 10) : "—"} → {c.end_date ? new Date(c.end_date).toISOString().slice(0, 10) : "—"}</dd></div>
              <div><dt>Spend</dt><dd className="tabular-nums">{money(d.spent)}{c.budget_usd ? ` of ${money(c.budget_usd)}` : ""}</dd></div>
              <div><dt>Approved assets</dt><dd>{d.jobs.filter((j) => j.status === "approved").length} of {plan.length}</dd></div>
            </dl>
            {c.budget_usd && Number(d.spent) >= Number(c.budget_usd) && <div className="mt-3"><Notice tone="danger">The campaign budget is used up. Paid production steps will be refused.</Notice></div>}
            {ctx.can.edit && (
              <form action={setCampaignStatusAction} className="mt-4 flex gap-2 border-t border-border pt-4">
                <input type="hidden" name="campaign_id" value={id} />
                <Select name="status" defaultValue={c.status} aria-label="Campaign status">
                  {["draft", "in_production", "active", "completed", "archived"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </Select>
                <Button variant="secondary">Set</Button>
              </form>
            )}
          </Card>

          <Card title="Publication calendar">
            {d.pubs.length ? (
              <ul className="space-y-2 text-sm">
                {d.pubs.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/distribution/${p.id}`} className="min-w-0 truncate hover:text-accent"><span className="capitalize">{p.platform}</span> · {p.title}</Link>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Publications appear here once approved assets are prepared for publication. Planned dates are shown in the asset list.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

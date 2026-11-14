import Link from "next/link";
import { BrandChip, Card, Empty, LinkButton, money, PageHeader, Stat, StatusBadge, Table, when } from "@/components/ui";
import { product } from "@/config/product";
import { requireContext } from "@/lib/context";
import { contentType } from "@/lib/content/catalog";

export default async function OverviewPage() {
  const ctx = await requireContext();
  const ws = ctx.workspace.id;
  const d = await ctx.db(async (tx) => ({
    counts: (await tx`
      select
        (select count(*) from brands where workspace_id = ${ws} and status = 'active') as brands,
        (select count(*) from projects where workspace_id = ${ws} and status = 'active') as projects,
        (select count(*) from content_jobs where workspace_id = ${ws} and status in ('awaiting_approval', 'approved')) as produced,
        (select count(*) from content_jobs where workspace_id = ${ws} and status in ('awaiting_approval', 'paused_for_review')) as pending,
        (select count(*) from content_jobs where workspace_id = ${ws} and status in ('queued', 'running')) as in_production,
        (select count(*) from publication_jobs where workspace_id = ${ws} and status in ('scheduled', 'ready_manual')) as scheduled,
        (select count(*) from publication_jobs where workspace_id = ${ws} and status = 'published') as published,
        (select coalesce(sum(amount_usd), 0) from production_costs where workspace_id = ${ws} and created_at >= date_trunc('month', now())) as cost_month,
        (select count(*) from provider_usage where workspace_id = ${ws} and created_at >= date_trunc('month', now())) as calls,
        (select count(*) from provider_usage where workspace_id = ${ws} and created_at >= date_trunc('month', now()) and adapter <> 'local-template') as ai_calls
    `)[0],
    jobs: await tx`
      select j.id, j.title, j.status, j.content_type, j.created_at, j.actual_cost_usd, b.name as brand, b.palette
      from content_jobs j join brands b on b.id = j.brand_id where j.workspace_id = ${ws} order by j.created_at desc limit 8`,
    attention: await tx`
      select j.id, j.title, j.status, j.errors from content_jobs j
      where j.workspace_id = ${ws} and j.status in ('failed', 'changes_requested') order by j.updated_at desc limit 5`,
    platforms: await tx`
      select platform, metric, sum(value) as total from analytics where workspace_id = ${ws} and metric in ('views', 'engagement')
      group by platform, metric order by total desc limit 6`,
  }));
  const c = d.counts;

  return (
    <>
      <PageHeader title="Overview" subtitle={`${product.tagline} Everything below is for the ${ctx.workspace.name} workspace.`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Brands" value={c.brands} href="/brands" />
        <Stat label="Active projects" value={c.projects} href="/brands" />
        <Stat label="Content produced" value={c.produced} hint={`${c.in_production} in production`} href="/studio/all" />
        <Stat label="Pending approvals" value={c.pending} href="/studio/all?status=review" />
        <Stat label="Scheduled publications" value={c.scheduled} href="/calendar" />
        <Stat label="Published" value={c.published} hint="Confirmed only" href="/distribution" />
        <Stat label="Production cost" value={money(c.cost_month)} hint="This month" href="/analytics" />
        <Stat label="Provider calls" value={c.calls} hint={`${c.ai_calls} to AI models this month`} href="/providers" />
      </div>

      {Number(c.brands) === 0 ? (
        <div className="mt-8">
          <Empty
            title="Start by creating a brand"
            action={<div className="flex gap-2"><LinkButton variant="primary" href="/brands">Create a brand</LinkButton></div>}
          >
            Every piece of content belongs to a brand and inherits its identity. Create your own, or install the INNERWORKS sample brand to explore.
          </Empty>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card title="Recent production" className="lg:col-span-2" action={<Link href="/studio/all" className="text-xs text-muted hover:text-text">View all</Link>}>
            {d.jobs.length ? (
              <Table head={["Content", "Brand", "Status", "Cost", "Created"]}>
                {d.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">{j.title}</Link>
                      <div className="text-xs text-muted">{contentType(j.content_type)?.label ?? j.content_type}</div>
                    </td>
                    <td><BrandChip name={j.brand} palette={j.palette} /></td>
                    <td><StatusBadge status={j.status} /></td>
                    <td className="tabular-nums">{money(j.actual_cost_usd)}</td>
                    <td className="whitespace-nowrap text-muted">{when(j.created_at)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-sm text-muted">Nothing produced yet. Use <span className="font-medium text-text">Create new content</span> to start.</p>
            )}
          </Card>

          <div className="space-y-6">
            <Card title="Needs attention">
              {d.attention.length ? (
                <ul className="space-y-3 text-sm">
                  {d.attention.map((j) => (
                    <li key={j.id}>
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">{j.title}</Link> <StatusBadge status={j.status} />
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted">{(j.errors as { message: string }[]).at(-1)?.message}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No failed jobs or requested changes.</p>
              )}
            </Card>
            <Card title="Platform performance">
              {d.platforms.length ? (
                <ul className="space-y-2 text-sm">
                  {d.platforms.map((p) => (
                    <li key={p.platform + p.metric} className="flex justify-between">
                      <span className="capitalize">{p.platform} · {p.metric}</span>
                      <span className="tabular-nums">{Number(p.total).toLocaleString("en-US")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No performance data recorded yet. Add metrics in <Link href="/analytics" className="underline">Analytics</Link>.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

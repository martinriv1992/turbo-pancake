import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/client";
import { BrandChip, Card, Empty, LinkButton, money, PageHeader, StatusBadge, Table, when } from "@/components/ui";
import { loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { candidates } from "@/lib/ai/registry";
import { contentType, MODULES, typesOf, type Module } from "@/lib/content/catalog";

const FILTERS: Record<string, { label: string; statuses: string[] | null }> = {
  all: { label: "All", statuses: null },
  active: { label: "In production", statuses: ["queued", "running"] },
  review: { label: "Needs review", statuses: ["paused_for_review", "awaiting_approval", "changes_requested"] },
  approved: { label: "Approved", statuses: ["approved"] },
  closed: { label: "Failed / closed", statuses: ["failed", "rejected", "cancelled"] },
};

export default async function StudioPage({ params, searchParams }: { params: Promise<{ module: string }>; searchParams: Promise<{ status?: string }> }) {
  const { module: m } = await params;
  const { status = "all" } = await searchParams;
  if (m !== "all" && !(m in MODULES)) notFound();
  const mod = m === "all" ? null : (m as Module);
  const filter = FILTERS[status] ?? FILTERS.all;
  const ctx = await requireContext();

  const d = await ctx.db(async (tx) => ({
    jobs: await tx`
      select j.id, j.title, j.status, j.content_type, j.module, j.current_stage, j.actual_cost_usd, j.created_at, b.name as brand, b.palette
      from content_jobs j join brands b on b.id = j.brand_id
      where j.workspace_id = ${ctx.workspace.id}
        ${mod ? tx`and j.module = ${mod}` : tx``}
        ${filter.statuses ? tx`and j.status in ${tx(filter.statuses)}` : tx``}
      order by j.created_at desc limit 100`,
    providers: await loadProviders(tx, ctx.org.id),
  }));
  const working = d.jobs.some((j) => j.status === "queued" || j.status === "running");
  const types = mod ? typesOf(mod) : [];
  const available = types.filter((t) => t.produces.some((c) => candidates(d.providers, c).length) || t.module === "writing" || t.module === "document");

  return (
    <>
      {working && <AutoRefresh everyMs={3000} />}
      <PageHeader
        title={mod ? MODULES[mod].studio : "Content Studio"}
        subtitle={mod ? MODULES[mod].blurb : "Every production job in this workspace, across all formats and brands."}
        actions={ctx.can.edit && <LinkButton variant="primary" href={mod ? `/create?module=${mod}` : "/create"}>Create {mod ? MODULES[mod].label.toLowerCase() : "content"}</LinkButton>}
      />

      {mod && (
        <Card className="mb-6" title="What this studio can produce right now" action={<span className="text-xs text-muted">{available.length} of {types.length} formats available</span>}>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => {
              const on = available.includes(t);
              return on ? (
                <Link key={t.key} href={`/create?type=${t.key}`} className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent">{t.label}</Link>
              ) : (
                <span key={t.key} className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted/70" title={`Needs a ${t.produces.join(" or ")} provider`}>{t.label}</span>
              );
            })}
          </div>
          {available.length < types.length && (
            <p className="mt-3 text-xs text-muted">
              Dashed formats need a generative provider (for example image, video or voice models) that is not installed yet. See <Link href="/providers" className="underline">AI Providers</Link>.
            </p>
          )}
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-1 text-sm">
        {Object.entries(FILTERS).map(([k, f]) => (
          <Link key={k} href={`/studio/${m}?status=${k}`} className={`rounded-md px-3 py-1.5 ${k === status ? "bg-surface-2 font-medium" : "text-muted hover:text-text"}`}>{f.label}</Link>
        ))}
      </div>

      {d.jobs.length ? (
        <Card>
          <Table head={["Content", "Brand", "Stage", "Status", "Cost", "Created"]}>
            {d.jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">{j.title}</Link>
                  <div className="text-xs text-muted">{contentType(j.content_type)?.label ?? j.content_type}</div>
                </td>
                <td><BrandChip name={j.brand} palette={j.palette} /></td>
                <td className="capitalize text-muted">{String(j.current_stage ?? "").replace(/_/g, " ")}</td>
                <td><StatusBadge status={j.status} /></td>
                <td className="tabular-nums">{money(j.actual_cost_usd)}</td>
                <td className="whitespace-nowrap text-muted">{when(j.created_at)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
        <Empty title="Nothing here yet">{status === "all" ? "Production jobs appear here once you create content." : "No jobs match this filter."}</Empty>
      )}
    </>
  );
}

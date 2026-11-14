import Link from "next/link";
import { BrandIdentityFields } from "@/components/brand-forms";
import { Badge, Button, Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { createBrandAction, installSampleBrandAction } from "@/server/actions/brands";

export default async function BrandsPage() {
  const ctx = await requireContext();
  const brands = await ctx.db((tx) => tx`
    select b.id, b.name, b.tagline, b.industry, b.palette, b.status, b.is_sample, g.status as guideline_status,
      (select count(*) from content_jobs j where j.brand_id = b.id) as jobs,
      (select count(*) from projects p where p.brand_id = b.id) as projects
    from brands b left join brand_guidelines g on g.brand_id = b.id
    where b.workspace_id = ${ctx.workspace.id} order by b.status, b.created_at`);
  const hasSample = brands.some((b) => b.is_sample);

  return (
    <>
      <PageHeader
        title="Brands"
        subtitle="Each brand keeps its own identity, guidelines, audiences, products, assets and history. Nothing is shared between brands."
      />

      {brands.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.id}`} className="group overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-muted">
              <div className="flex h-16">
                {((b.palette as { hex: string }[]).length ? (b.palette as { hex: string }[]) : [{ hex: "#3a3a44" }]).map((p, i) => (
                  <div key={i} className="flex-1" style={{ background: p.hex }} />
                ))}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold group-hover:text-accent">{b.name}</h2>
                  {b.is_sample && <Badge tone="info">Sample</Badge>}
                </div>
                <p className="mt-0.5 line-clamp-1 text-sm text-muted">{b.tagline || b.industry || "No tagline yet"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>Guidelines:</span> <StatusBadge status={b.guideline_status ?? "draft"} />
                  {b.status === "archived" && <StatusBadge status="archived" />}
                  <span className="ml-auto">{b.projects} projects · {b.jobs} assets</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No brands in this workspace yet">Create one below, or install the sample brand to see a complete profile.</Empty>
      )}

      {ctx.can.edit && (
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Card title="Create a brand" className="lg:col-span-2">
            <form action={createBrandAction} className="space-y-4">
              <BrandIdentityFields />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted">Next step: the Brand Builder, where you define voice, pillars and guidelines.</p>
                <Button>Create brand</Button>
              </div>
            </form>
          </Card>
          <Card title="Sample brand">
            <p className="text-sm leading-relaxed text-muted">
              <span className="font-medium text-text">INNERWORKS</span> is an engineering documentary brand with a full profile: guidelines, content pillars,
              a documentary workflow, 3D production requirements and publishing targets. It is installed as ordinary, editable brand data.
            </p>
            <form action={installSampleBrandAction} className="mt-4">
              <Button variant="secondary" disabled={hasSample}>{hasSample ? "Already installed" : "Install INNERWORKS"}</Button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}

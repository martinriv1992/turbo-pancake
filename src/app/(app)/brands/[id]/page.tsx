import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandIdentityFields } from "@/components/brand-forms";
import { Badge, Button, Card, Field, fileUrl, Input, LinkButton, money, PageHeader, Select, StatusBadge, Textarea, when } from "@/components/ui";
import { loadBrandContext } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { contentType, PLATFORMS } from "@/lib/content/catalog";
import { slideSvg } from "@/lib/render/layout";
import {
  addBrandItemAction, archiveBrandAction, deleteBrandItemAction, updateBrandAction, uploadBrandAssetAction,
} from "@/server/actions/brands";

function Remove({ brandId, kind, id }: { brandId: string; kind: string; id: string }) {
  return (
    <form action={deleteBrandItemAction}>
      <input type="hidden" name="brand_id" value={brandId} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
      <button className="cursor-pointer text-xs text-muted hover:text-danger" aria-label="Remove">Remove</button>
    </form>
  );
}

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => {
    const [brand] = await tx`select * from brands where id = ${id}`;
    if (!brand) return null;
    return {
      brand,
      context: await loadBrandContext(tx, id),
      guidelines: (await tx`select status, version, updated_at, source from brand_guidelines where brand_id = ${id}`)[0],
      audiences: await tx`select * from audiences where brand_id = ${id} order by created_at`,
      products: await tx`select * from products where brand_id = ${id} order by created_at`,
      assets: await tx`select * from brand_assets where brand_id = ${id} order by created_at desc`,
      social: await tx`select * from social_accounts where brand_id = ${id} order by platform`,
      projects: await tx`select p.*, (select count(*) from content_jobs j where j.project_id = p.id) as jobs,
                           (select coalesce(sum(amount_usd), 0) from production_costs c where c.project_id = p.id) as spent
                         from projects p where p.brand_id = ${id} order by p.created_at`,
      jobs: await tx`select id, title, status, content_type, created_at from content_jobs where brand_id = ${id} order by created_at desc limit 10`,
      spent: (await tx`select coalesce(sum(amount_usd), 0) as v from production_costs where brand_id = ${id} and created_at >= date_trunc('month', now())`)[0].v,
    };
  });
  if (!d) notFound();
  const { brand } = d;
  const preview = `data:image/svg+xml;utf8,${encodeURIComponent(
    slideSvg(d.context, { kicker: brand.industry ?? undefined, headline: brand.tagline || brand.name, body: brand.description ?? undefined, cta: "Learn more" }, 1080, 1080),
  )}`;
  const hidden = <input type="hidden" name="brand_id" value={id} />;

  return (
    <>
      <PageHeader
        title={brand.name}
        subtitle={brand.tagline ?? brand.description ?? undefined}
        actions={
          <>
            {brand.is_sample && <Badge tone="info">Sample brand</Badge>}
            <LinkButton href={`/brand-builder?brand=${id}`}>Brand Builder</LinkButton>
            {ctx.can.edit && <LinkButton variant="primary" href={`/create?brand=${id}`}>Create content</LinkButton>}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Brand identity">
            <form action={updateBrandAction} className="space-y-4">
              {hidden}
              <BrandIdentityFields brand={brand as never} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Heading typeface"><Input name="font_heading" defaultValue={brand.typography?.heading ?? ""} /></Field>
                <Field label="Body typeface"><Input name="font_body" defaultValue={brand.typography?.body ?? ""} /></Field>
                <Field label="Monthly budget (USD)" hint={`${money(d.spent)} spent this month`}>
                  <Input name="monthly_budget_usd" type="number" min="0" step="0.01" defaultValue={brand.monthly_budget_usd ?? ""} placeholder="No limit" />
                </Field>
              </div>
              {ctx.can.edit && <div className="flex justify-end"><Button>Save identity</Button></div>}
            </form>
          </Card>

          <Card title="Content projects">
            {d.projects.length ? (
              <ul className="mb-4 divide-y divide-border text-sm">
                {d.projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{p.description}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span>{p.jobs} assets · {money(p.spent)}{p.budget_usd ? ` of ${money(p.budget_usd)}` : ""}</span>
                      <StatusBadge status={p.status} />
                      {ctx.can.edit && <Link className="text-accent hover:underline" href={`/create?brand=${id}&project=${p.id}`}>Create content</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-muted">No projects yet. A project groups related content and can carry its own budget.</p>}
            {ctx.can.edit && (
              <form action={addBrandItemAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
                {hidden}<input type="hidden" name="kind" value="project" />
                <Field label="Project name"><Input name="name" required /></Field>
                <Field label="Description"><Input name="description" /></Field>
                <Field label="Budget (USD)"><Input name="budget_usd" type="number" min="0" step="0.01" placeholder="No limit" /></Field>
                <Button variant="secondary">Add project</Button>
              </form>
            )}
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Audiences">
              <ul className="mb-4 space-y-3 text-sm">
                {d.audiences.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <div><div className="font-medium">{a.name}</div><div className="text-xs text-muted">{a.description}</div></div>
                    {ctx.can.edit && <Remove brandId={id} kind="audience" id={a.id} />}
                  </li>
                ))}
                {!d.audiences.length && <li className="text-muted">No audience profiles yet.</li>}
              </ul>
              {ctx.can.edit && (
                <form action={addBrandItemAction} className="space-y-2">
                  {hidden}<input type="hidden" name="kind" value="audience" />
                  <Input name="name" placeholder="Audience name" required aria-label="Audience name" />
                  <Textarea name="description" placeholder="Who they are" rows={2} aria-label="Audience description" />
                  <Button variant="secondary">Add audience</Button>
                </form>
              )}
            </Card>
            <Card title="Product catalog">
              <ul className="mb-4 space-y-3 text-sm">
                {d.products.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3">
                    <div><div className="font-medium">{p.name} {p.price && <span className="font-normal text-muted">· {p.price}</span>}</div><div className="text-xs text-muted">{p.description}</div></div>
                    {ctx.can.edit && <Remove brandId={id} kind="product" id={p.id} />}
                  </li>
                ))}
                {!d.products.length && <li className="text-muted">No products yet.</li>}
              </ul>
              {ctx.can.edit && (
                <form action={addBrandItemAction} className="space-y-2">
                  {hidden}<input type="hidden" name="kind" value="product" />
                  <div className="grid grid-cols-[1fr_110px] gap-2">
                    <Input name="name" placeholder="Product name" required aria-label="Product name" />
                    <Input name="price" placeholder="Price" aria-label="Price" />
                  </div>
                  <Textarea name="description" placeholder="Description" rows={2} aria-label="Product description" />
                  <Button variant="secondary">Add product</Button>
                </form>
              )}
            </Card>
          </div>

          <Card title="Brand assets" action={<span className="text-xs text-muted">Logos, product images, reference materials</span>}>
            {d.assets.length ? (
              <ul className="mb-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {d.assets.map((a) => (
                  <li key={a.id} className="overflow-hidden rounded-lg border border-border">
                    {String(a.mime_type).startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(a.storage_path)} alt={a.title} className="h-28 w-full bg-surface-2 object-contain" />
                    ) : <div className="flex h-28 items-center justify-center bg-surface-2 font-mono text-xs uppercase text-muted">{String(a.mime_type).split("/")[1]}</div>}
                    <div className="flex items-start justify-between gap-2 p-2.5 text-xs">
                      <div className="min-w-0">
                        <a href={fileUrl(a.storage_path)} target="_blank" className="block truncate font-medium hover:text-accent">{a.title}</a>
                        <span className="text-muted">{String(a.kind).replace("_", " ")}{a.approved ? " · approved reference" : ""}</span>
                      </div>
                      {ctx.can.edit && <Remove brandId={id} kind="asset" id={a.id} />}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-muted">No assets uploaded yet.</p>}
            {ctx.can.edit && (
              <form action={uploadBrandAssetAction} className="grid gap-3 sm:grid-cols-[1fr_170px_1fr_auto] sm:items-end">
                {hidden}
                <Field label="File"><Input name="file" type="file" required className="file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-text" /></Field>
                <Field label="Type">
                  <Select name="asset_kind" defaultValue="reference">
                    <option value="logo">Logo</option><option value="product_image">Product image</option><option value="reference">Reference</option>
                    <option value="marketing_material">Marketing material</option><option value="font">Font</option><option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Title"><Input name="title" placeholder="Optional" /></Field>
                <Button variant="secondary">Upload</Button>
                {ctx.can.approve && (
                  <label className="flex items-center gap-2 text-xs text-muted sm:col-span-4">
                    <input type="checkbox" name="approved" /> Mark as an approved reference asset
                  </label>
                )}
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Brand preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={`${brand.name} layout preview`} className="w-full rounded-lg border border-border" />
            <p className="mt-2 text-xs text-muted">How this brand's palette renders in the built-in layout engine.</p>
          </Card>

          <Card title="Guidelines">
            <div className="flex items-center justify-between text-sm">
              <StatusBadge status={d.guidelines?.status ?? "draft"} />
              <span className="text-xs text-muted">v{d.guidelines?.version ?? 1} · {when(d.guidelines?.updated_at)}</span>
            </div>
            <p className="mt-3 text-sm text-muted">
              {d.guidelines?.status === "locked" ? "Locked: every content request inherits these guidelines unchanged."
                : d.guidelines?.status === "approved" ? "Approved. Lock them to prevent further edits."
                : "Still a draft. Content can be produced, but quality control will flag it."}
            </p>
            <LinkButton href={`/brand-builder?brand=${id}`} className="mt-3">Open Brand Builder</LinkButton>
          </Card>

          <Card title="Social accounts" action={<span className="text-xs text-muted">Publishing targets</span>}>
            <ul className="mb-4 space-y-2 text-sm">
              {d.social.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium capitalize">{s.platform}</span> <span className="text-muted">{s.handle}</span>
                    {s.display_name && <div className="truncate text-xs text-muted">{s.display_name}</div>}
                  </div>
                  {ctx.can.edit && <Remove brandId={id} kind="social" id={s.id} />}
                </li>
              ))}
              {!d.social.length && <li className="text-muted">No accounts yet.</li>}
            </ul>
            {ctx.can.edit && (
              <form action={addBrandItemAction} className="space-y-2">
                {hidden}<input type="hidden" name="kind" value="social" />
                <div className="grid grid-cols-2 gap-2">
                  <Select name="platform" aria-label="Platform">{PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select>
                  <Input name="handle" placeholder="@handle" required aria-label="Handle" />
                </div>
                <Button variant="secondary">Add account</Button>
              </form>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Accounts are publishing targets for manual packages. Direct API publishing is not connected yet.
            </p>
          </Card>

          <Card title="Content history">
            <ul className="space-y-2.5 text-sm">
              {d.jobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <Link href={`/jobs/${j.id}`} className="min-w-0 truncate hover:text-accent">
                    {j.title} <span className="text-xs text-muted">· {contentType(j.content_type)?.label}</span>
                  </Link>
                  <StatusBadge status={j.status} />
                </li>
              ))}
              {!d.jobs.length && <li className="text-muted">Nothing produced for this brand yet.</li>}
            </ul>
          </Card>

          {ctx.can.edit && (
            <form action={archiveBrandAction}>
              {hidden}<input type="hidden" name="status" value={brand.status === "active" ? "archived" : "active"} />
              <Button variant="ghost">{brand.status === "active" ? "Archive brand" : "Restore brand"}</Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

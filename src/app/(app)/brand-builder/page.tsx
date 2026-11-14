import Link from "next/link";
import { Badge, BrandChip, Button, Card, Empty, Field, LinkButton, Notice, PageHeader, StatusBadge, Textarea, when } from "@/components/ui";
import { loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { candidates } from "@/lib/ai/registry";
import { generateGuidelinesAction, saveGuidelinesAction, setGuidelineStatusAction } from "@/server/actions/brands";

const join = (v: string[] | null | undefined) => (v ?? []).join("\n");

export default async function BrandBuilderPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandId } = await searchParams;
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    brands: await tx`select b.id, b.name, b.palette, g.status from brands b left join brand_guidelines g on g.brand_id = b.id
                     where b.workspace_id = ${ctx.workspace.id} and b.status = 'active' order by b.created_at`,
    brand: brandId ? (await tx`select * from brands where id = ${brandId}`)[0] : null,
    g: brandId ? (await tx`select g.*, pa.full_name as approved_name, pl.full_name as locked_name from brand_guidelines g
                           left join profiles pa on pa.id = g.approved_by left join profiles pl on pl.id = g.locked_by
                           where g.brand_id = ${brandId}`)[0] : null,
    assets: brandId ? (await tx`select count(*) as n from brand_assets where brand_id = ${brandId}`)[0].n : 0,
    providers: await loadProviders(tx, ctx.org.id),
  }));

  if (!d.brand || !d.g) {
    return (
      <>
        <PageHeader title="Brand Builder" subtitle="Define a brand's positioning, voice, visual identity and content pillars. Every content request inherits them." />
        {d.brands.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.brands.map((b) => (
              <Link key={b.id} href={`/brand-builder?brand=${b.id}`} className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 hover:border-muted">
                <BrandChip name={b.name} palette={b.palette} /> <StatusBadge status={b.status ?? "draft"} />
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="Create a brand first" action={<LinkButton variant="primary" href="/brands">Go to Brands</LinkButton>}>
            The Brand Builder works on an existing brand.
          </Empty>
        )}
      </>
    );
  }

  const { brand, g } = d;
  const locked = g.status === "locked";
  const [textProvider] = candidates(d.providers, "text", "quality", "brand_guidelines");
  const hidden = <input type="hidden" name="brand_id" value={brand.id} />;
  const area = (name: string, label: string, value: string | null, hint?: string, rows = 3) => (
    <Field label={label} hint={hint}><Textarea name={name} defaultValue={value ?? ""} rows={rows} disabled={locked || !ctx.can.edit} /></Field>
  );

  return (
    <>
      <PageHeader
        title={`Brand Builder — ${brand.name}`}
        subtitle="Draft, edit, approve and lock the guidelines that every piece of content for this brand inherits."
        actions={<><StatusBadge status={g.status} /><LinkButton href={`/brands/${brand.id}`}>Brand profile</LinkButton></>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Guidelines" action={<span className="text-xs text-muted">v{g.version} · updated {when(g.updated_at)}</span>}>
            {locked && <div className="mb-4"><Notice tone="ok">These guidelines are locked{g.locked_name ? ` by ${g.locked_name}` : ""}. Unlock them to make changes.</Notice></div>}
            {g.source !== "manual" && !locked && (
              <div className="mb-4">
                <Notice tone={g.source === "ai" ? "info" : "warn"}>
                  {g.source === "ai" ? `Drafted by ${g.generated_by}. Check every statement before approving.`
                    : `Starting point from: ${g.generated_by}. Not written by AI — review and replace any placeholders.`}
                </Notice>
              </div>
            )}
            <form action={saveGuidelinesAction} className="space-y-4">
              {hidden}
              {area("positioning", "Brand positioning", g.positioning, "What the brand is, for whom, and why it is different.")}
              <div className="grid gap-4 sm:grid-cols-2">
                {area("personality", "Brand personality", join(g.personality), "One trait per line.")}
                {area("tone", "Communication tone", g.tone)}
                {area("voice_do", "Always", join(g.voice_do), "One rule per line.", 4)}
                {area("voice_dont", "Never", join(g.voice_dont), "One rule per line.", 4)}
              </div>
              {area("visual_identity", "Visual identity", g.visual_identity, "Imagery style, layout principles, logo usage.")}
              {area("content_pillars", "Content pillars", (g.content_pillars as { name: string; description?: string }[]).map((p) => `${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n"), "One per line, as “Name: description”.", 5)}
              <div className="grid gap-4 sm:grid-cols-2">
                {area("key_messages", "Messaging guidelines", join(g.key_messages), "Key messages, one per line.", 4)}
                {area("objectives", "Marketing objectives", join(g.objectives), "One per line.", 4)}
              </div>
              {area("creative_guidelines", "Creative guidelines", g.creative_guidelines)}
              {area("content_strategy", "Content and social strategy", g.content_strategy)}
              {area("production_requirements", "Production requirements", g.production_requirements, "Formats, 3D or footage standards, review rules.")}
              {area("banned_terms", "Banned terms", join(g.banned_terms), "One per line. Quality control blocks content containing them.", 2)}
              {ctx.can.edit && !locked && <div className="flex justify-end"><Button>Save guidelines</Button></div>}
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Approval">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Status</dt><dd><StatusBadge status={g.status} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted">Approved</dt><dd>{g.approved_at ? `${g.approved_name ?? "—"} · ${when(g.approved_at)}` : "Not yet"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Locked</dt><dd>{g.locked_at && locked ? when(g.locked_at) : "No"}</dd></div>
            </dl>
            {ctx.can.approve ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {g.status === "draft" && <form action={setGuidelineStatusAction}>{hidden}<input type="hidden" name="status" value="approved" /><Button>Approve</Button></form>}
                {g.status === "approved" && (
                  <>
                    <form action={setGuidelineStatusAction}>{hidden}<input type="hidden" name="status" value="locked" /><Button>Lock</Button></form>
                    <form action={setGuidelineStatusAction}>{hidden}<input type="hidden" name="status" value="draft" /><Button variant="secondary">Back to draft</Button></form>
                  </>
                )}
                {locked && <form action={setGuidelineStatusAction}>{hidden}<input type="hidden" name="status" value="approved" /><Button variant="secondary">Unlock</Button></form>}
              </div>
            ) : <p className="mt-3 text-xs text-muted">Approving and locking needs a role with approval rights.</p>}
          </Card>

          {ctx.can.edit && !locked && (
            <Card title="Assisted onboarding">
              <p className="mb-3 text-sm leading-relaxed text-muted">
                Paste what you have — about text, existing marketing copy, product descriptions — and get a first draft of the guidelines to edit.
              </p>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">Will use:</span>
                {textProvider ? <Badge tone={textProvider.adapter.generative ? "info" : "warn"}>{textProvider.provider.name}</Badge> : <Badge tone="danger">No text provider</Badge>}
              </div>
              {textProvider && !textProvider.adapter.generative && (
                <div className="mb-3">
                  <Notice tone="warn">
                    No AI provider is configured, so this creates a starter structure from your inputs rather than an analysis.
                    Add one in <Link href="/providers" className="underline">AI Providers</Link> for an AI-written draft.
                  </Notice>
                </div>
              )}
              <form action={generateGuidelinesAction} className="space-y-3">
                {hidden}
                <Field label="Brand materials"><Textarea name="materials" rows={5} defaultValue={brand.description ?? ""} placeholder="Paste descriptions, existing copy, product info…" /></Field>
                <Field label="Target audience"><Textarea name="audience" rows={2} /></Field>
                <Field label="Key messages" hint="One per line."><Textarea name="key_messages" rows={2} /></Field>
                <Field label="Main marketing objective"><Textarea name="objective" rows={2} /></Field>
                <Button variant="secondary" disabled={!textProvider}>Generate draft guidelines</Button>
              </form>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                This overwrites the current draft. The draft is built from the text above and the brand profile; it does not yet read the website
                or analyse uploaded images ({String(d.assets)} asset{Number(d.assets) === 1 ? "" : "s"} on file).
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

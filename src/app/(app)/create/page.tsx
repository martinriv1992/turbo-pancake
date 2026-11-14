import Link from "next/link";
import { Badge, BrandChip, Button, Card, Empty, Field, Input, LinkButton, money, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { contentType, LANGUAGES, MODULES, PLATFORMS, STAGE_LABELS, typesOf, type Module } from "@/lib/content/catalog";
import { budgetStatus } from "@/lib/jobs/budget";
import { planJob, resolveWorkflow } from "@/lib/jobs/plan";
import type { RoutingPreference } from "@/lib/ai/registry";
import { createJobAction } from "@/server/actions/content";

type Params = { brand?: string; module?: string; type?: string; project?: string; campaign?: string };

export default async function CreatePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const prefer = (ctx.org.settings.routing_preference as RoutingPreference) ?? "quality";
  const selectedType = contentType(sp.type ?? "");
  const module = (selectedType?.module ?? (sp.module && sp.module in MODULES ? sp.module : "writing")) as Module;

  const d = await ctx.db(async (tx) => {
    const brands = await tx`select b.id, b.name, b.palette, b.primary_language, g.status as guideline_status
      from brands b left join brand_guidelines g on g.brand_id = b.id
      where b.workspace_id = ${ctx.workspace.id} and b.status = 'active' order by b.created_at`;
    const brand = brands.find((b) => b.id === sp.brand) ?? (brands.length === 1 ? brands[0] : undefined);
    const providers = await loadProviders(tx, ctx.org.id);
    // Plan every type of the module for this brand, so unavailable types can say why.
    const plans = new Map<string, ReturnType<typeof planJob>>();
    if (brand) {
      for (const t of typesOf(module)) {
        plans.set(t.key, planJob(t, await resolveWorkflow(tx, { orgId: ctx.org.id, brandId: brand.id, module: t.module, contentType: t.key }), providers, prefer));
      }
    }
    return {
      brands, brand, plans,
      projects: brand ? await tx`select id, name from projects where brand_id = ${brand.id} and status = 'active' order by created_at` : [],
      campaigns: brand ? await tx`select id, name from campaigns where brand_id = ${brand.id} and status <> 'archived' order by created_at desc` : [],
      audiences: brand ? await tx`select name from audiences where brand_id = ${brand.id} order by created_at` : [],
      budgets: brand ? await budgetStatus(tx, { org_id: ctx.org.id, brand_id: brand.id, project_id: sp.project ?? null, campaign_id: sp.campaign ?? null }) : [],
    };
  });

  const q = (over: Params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ brand: d.brand?.id, module, type: selectedType?.key, project: sp.project, campaign: sp.campaign, ...over })) if (v) p.set(k, v);
    return `/create?${p}`;
  };
  const plan = selectedType && d.plans.get(selectedType.key);
  const step = (n: number, label: string) => (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent font-mono text-[11px] text-accent-fg">{n}</span>{label}
    </h2>
  );

  if (!ctx.can.edit) return <Empty title="You do not have permission to create content">Ask an administrator for a producer or editor role.</Empty>;
  if (!d.brands.length) {
    return (
      <>
        <PageHeader title="Create new content" />
        <Empty title="Create a brand first" action={<LinkButton variant="primary" href="/brands">Go to Brands</LinkButton>}>Content always belongs to a brand and inherits its identity.</Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Create new content" subtitle="Select a brand, choose what to make, describe the result, and start production." />

      <section className="mb-8">
        {step(1, "Brand")}
        <div className="flex flex-wrap gap-2">
          {d.brands.map((b) => (
            <Link key={b.id} href={q({ brand: b.id, project: undefined, campaign: undefined })}
              className={`rounded-lg border px-3 py-2 ${d.brand?.id === b.id ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-muted"}`}>
              <BrandChip name={b.name} palette={b.palette} />
            </Link>
          ))}
        </div>
      </section>

      {d.brand && (
        <section className="mb-8">
          {step(2, "Content type")}
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1 text-sm sm:inline-flex">
            {(Object.keys(MODULES) as Module[]).map((m) => (
              <Link key={m} href={q({ module: m, type: undefined })} className={`rounded-md px-3 py-1.5 ${m === module ? "bg-surface-2 font-medium" : "text-muted hover:text-text"}`}>
                {MODULES[m].label}
              </Link>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {typesOf(module).map((t) => {
              const p = d.plans.get(t.key);
              const active = selectedType?.key === t.key;
              return p?.blocked ? (
                <div key={t.key} className="rounded-lg border border-dashed border-border p-3 opacity-70" title={p.blocked}>
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted">Unavailable: needs a {t.produces.join(" or ")} provider</div>
                </div>
              ) : (
                <Link key={t.key} href={q({ type: t.key })} className={`rounded-lg border p-3 ${active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-muted"}`}>
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted">{p?.usesAI ? "AI-generated" : "Built-in template engine"} · {money(p?.total ?? 0)}</div>
                </Link>
              );
            })}
          </div>
          {typesOf(module).some((t) => d.plans.get(t.key)?.blocked) && (
            <p className="mt-3 text-xs text-muted">
              Unavailable types need a generative provider that is not installed yet. See <Link href="/providers" className="underline">AI Providers</Link> for what is covered.
            </p>
          )}
        </section>
      )}

      {d.brand && selectedType && plan && !plan.blocked && (
        <section>
          {step(3, `Describe the ${selectedType.label.toLowerCase()}`)}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <form action={createJobAction} className="space-y-4">
                <input type="hidden" name="brand_id" value={d.brand.id} />
                <input type="hidden" name="content_type" value={selectedType.key} />
                <Field label="Title"><Input name="title" required placeholder="A working title for this piece" /></Field>
                <Field label="What do you want?" hint="The result you want, the angle, anything that must be included.">
                  <Textarea name="description" rows={4} required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Objective"><Input name="objective" placeholder="e.g. Drive sign-ups for the launch" /></Field>
                  <Field label="Call to action"><Input name="cta" placeholder="e.g. Book a demo" /></Field>
                  <Field label="Key points" hint="One per line." className="sm:col-span-2"><Textarea name="key_points" rows={3} /></Field>
                  <Field label="Audience">
                    <Input name="audience" list="audiences" placeholder="Who is this for?" />
                    <datalist id="audiences">{d.audiences.map((a) => <option key={a.name} value={a.name} />)}</datalist>
                  </Field>
                  <Field label="Language">
                    <Select name="language" defaultValue={d.brand.primary_language}>{LANGUAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                  </Field>
                  {selectedType.formats && (
                    <Field label="Format">
                      <Select name="format">{selectedType.formats.map((f) => <option key={f} value={f}>{f}{f === "9:16" ? " vertical" : f === "16:9" ? " horizontal" : f === "1:1" ? " square" : ""}</option>)}</Select>
                    </Field>
                  )}
                  <Field label="Project">
                    <Select name="project_id" defaultValue={sp.project ?? ""}><option value="">No project</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                  </Field>
                  {d.campaigns.length > 0 && (
                    <Field label="Campaign">
                      <Select name="campaign_id" defaultValue={sp.campaign ?? ""}><option value="">No campaign</option>{d.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                    </Field>
                  )}
                </div>
                {selectedType.module !== "document" && (
                  <fieldset>
                    <legend className="mb-1.5 text-xs font-medium text-muted">Target platforms</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                      {PLATFORMS.filter((p) => p.key !== "other").map((p) => (
                        <label key={p.key} className="flex items-center gap-1.5"><input type="checkbox" name="platforms" value={p.key} /> {p.label}</label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {plan.total > 0 && (
                  <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                    <input type="checkbox" name="confirm_cost" className="mt-0.5" required />
                    <span>I confirm the estimated cost of <strong>{money(plan.total)}</strong> for this production.</span>
                  </label>
                )}
                <div className="flex justify-end"><Button>Start production</Button></div>
              </form>
            </Card>

            <div className="space-y-6">
              <Card title="Production plan" action={<span className="text-xs text-muted">{plan.workflow}</span>}>
                <ol className="space-y-2.5 text-sm">
                  {plan.stages.map((s, i) => (
                    <li key={s.key} className="flex gap-2.5">
                      <span className="mt-0.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2"><span>{STAGE_LABELS[s.key] ?? s.key}</span>{s.estimate > 0 && <span className="tabular-nums text-muted">{money(s.estimate)}</span>}</div>
                        {(s.provider || s.skipped) && <div className="text-xs text-muted">{s.skipped ?? s.provider}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex justify-between border-t border-border pt-3 text-sm font-medium"><span>Estimated cost</span><span className="tabular-nums">{money(plan.total)}</span></div>
                <p className="mt-1 text-xs text-muted">Estimate from typical usage and the prices set in AI Providers; the actual cost is recorded per call.</p>
              </Card>

              <Card title="Inherits from brand">
                <div className="flex items-center justify-between text-sm"><BrandChip name={d.brand.name} palette={d.brand.palette} /><StatusBadge status={d.brand.guideline_status ?? "draft"} /></div>
                <p className="mt-2 text-xs leading-relaxed text-muted">Voice, palette, pillars, audiences and banned terms come from this brand only.</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge>Mode: {ctx.workspace.automationMode.replace(/_/g, " ")}</Badge>
                  {d.budgets.map((b) => <Badge key={b.scope} tone={b.spent >= b.limit ? "danger" : "neutral"}>{b.scope}: {money(b.spent)} / {money(b.limit)}</Badge>)}
                </div>
              </Card>

              {!plan.usesAI && (
                <Notice tone="warn">
                  No AI provider is configured for this, so the built-in template engine will produce a structured draft
                  {selectedType.module === "image" ? " and a typographic brand layout" : selectedType.module === "video" ? " and a silent slide-based video" : ""}.
                  It is a starting point, not finished creative.
                </Notice>
              )}
            </div>
          </div>
        </section>
      )}

      {d.brand && selectedType && plan?.blocked && <Notice tone="danger">{plan.blocked}</Notice>}
    </>
  );
}

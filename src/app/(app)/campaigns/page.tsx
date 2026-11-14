import Link from "next/link";
import { BrandChip, Button, Card, Empty, Field, Input, money, PageHeader, Select, StatusBadge, Table, Textarea } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { createCampaignAction } from "@/server/actions/campaigns";

export default async function CampaignsPage() {
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    campaigns: await tx`
      select c.id, c.name, c.objective, c.status, c.start_date, c.budget_usd, b.name as brand, b.palette, jsonb_array_length(c.plan) as planned,
        (select count(*) from content_jobs j where j.campaign_id = c.id) as jobs,
        (select count(*) from content_jobs j where j.campaign_id = c.id and j.status = 'approved') as approved,
        (select coalesce(sum(amount_usd), 0) from production_costs pc where pc.campaign_id = c.id) as spent
      from campaigns c join brands b on b.id = c.brand_id where c.workspace_id = ${ctx.workspace.id} order by c.created_at desc`,
    brands: await tx`select id, name from brands where workspace_id = ${ctx.workspace.id} and status = 'active' order by created_at`,
  }));

  return (
    <>
      <PageHeader title="Campaigns" subtitle="Plan a campaign once and produce all of its related assets — sharing one objective, one key message and one brand identity." />

      {d.campaigns.length ? (
        <Card>
          <Table head={["Campaign", "Brand", "Status", "Assets", "Spend", "Starts"]}>
            {d.campaigns.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/campaigns/${c.id}`} className="font-medium hover:text-accent">{c.name}</Link><div className="line-clamp-1 text-xs text-muted">{c.objective}</div></td>
                <td><BrandChip name={c.brand} palette={c.palette} /></td>
                <td><StatusBadge status={c.status} /></td>
                <td className="tabular-nums">{c.approved} approved · {c.jobs} of {c.planned} started</td>
                <td className="tabular-nums">{money(c.spent)}{c.budget_usd ? ` / ${money(c.budget_usd)}` : ""}</td>
                <td className="whitespace-nowrap text-muted">{c.start_date ? new Date(c.start_date).toISOString().slice(0, 10) : "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : <Empty title="No campaigns yet">A product launch, for example, becomes a strategy, a hero creative, short videos, posts, a carousel, landing page copy, an email and a publication calendar.</Empty>}

      {ctx.can.edit && d.brands.length > 0 && (
        <Card title="Plan a campaign" className="mt-8">
          <form action={createCampaignAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand"><Select name="brand_id" required>{d.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
            <Field label="Campaign name"><Input name="name" required placeholder="e.g. Autumn collection launch" /></Field>
            <Field label="Objective" className="sm:col-span-2"><Input name="objective" required placeholder="What should this campaign achieve?" /></Field>
            <Field label="Key message"><Input name="key_message" placeholder="The one thing every asset should say" /></Field>
            <Field label="Call to action"><Input name="cta" /></Field>
            <Field label="What is being promoted?" className="sm:col-span-2"><Textarea name="description" rows={3} /></Field>
            <Field label="Audience"><Input name="audience" /></Field>
            <Field label="Budget (USD)" hint="Production stops when this is reached."><Input name="budget_usd" type="number" min="0" step="0.01" placeholder="No limit" /></Field>
            <Field label="Start date"><Input name="start_date" type="date" /></Field>
            <Field label="End date"><Input name="end_date" type="date" /></Field>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <p className="text-xs text-muted">The plan is drafted by your text provider. Nothing is produced until you review it.</p>
              <Button>Plan campaign</Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}

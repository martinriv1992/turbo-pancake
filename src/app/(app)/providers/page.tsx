import { Badge, Button, Card, Field, Input, money, Notice, PageHeader, Select, Table } from "@/components/ui";
import { loadProviders } from "@/lib/brand-context";
import { requireContext } from "@/lib/context";
import { ADAPTERS, candidates, unavailableReason } from "@/lib/ai/registry";
import { CAPABILITIES, CAPABILITY_LABELS } from "@/lib/ai/types";
import { addProviderAction, updateOrganizationAction, updateProviderAction } from "@/server/actions/admin";

const PRICE_FIELDS: [string, string][] = [
  ["input_per_mtok", "Input / 1M tokens"], ["output_per_mtok", "Output / 1M tokens"], ["per_image", "Per image"], ["per_second", "Per second"], ["per_render", "Per render"],
];

export default async function ProvidersPage() {
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    providers: await loadProviders(tx, ctx.org.id),
    usage: await tx`select provider_id, count(*)::int as calls, sum(cost_usd) as cost, max(created_at) as last from provider_usage
                    where org_id = ${ctx.org.id} and created_at >= date_trunc('month', now()) group by provider_id`,
  }));
  const prefer = ctx.org.settings.routing_preference ?? "quality";
  const manage = ctx.can.manageOrg;

  return (
    <>
      <PageHeader
        title="AI Providers"
        subtitle="Each task is routed to the best available provider for the job. Add, remove, reprioritise and reprice providers here — no rebuild needed."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {d.providers.map((p) => {
            const adapter = ADAPTERS[p.adapter];
            if (!adapter) return <Card key={p.id} title={p.name}><Notice tone="danger">The adapter “{p.adapter}” is not installed in this build.</Notice></Card>;
            const avail = adapter.availability(p.config);
            const u = d.usage.find((x) => x.provider_id === p.id);
            return (
              <Card key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.name}
                <Badge tone={!p.enabled ? "neutral" : avail.ok ? "ok" : "danger"}>{!p.enabled ? "Disabled" : avail.ok ? "Available" : "Not available"}</Badge>
                <Badge tone={adapter.generative ? "info" : "neutral"}>{adapter.generative ? "Generative AI" : "Not AI"}</Badge></span>}
                action={<span className="text-xs text-muted">{u ? `${u.calls} calls · ${money(u.cost)} this month` : "No calls this month"}</span>}>
                <p className="mb-3 text-sm text-muted">{adapter.description}</p>
                {!avail.ok && p.enabled && <div className="mb-4"><Notice tone="danger">{avail.reason} Set it where the app is deployed, then restart the server. Keys are never stored in the database.</Notice></div>}
                <form action={updateProviderAction} className="space-y-4">
                  <input type="hidden" name="id" value={p.id} />
                  <fieldset disabled={!manage} className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Field label="Name" className="sm:col-span-2"><Input name="name" defaultValue={p.name} /></Field>
                      <Field label="Quality (1–5)"><Input name="quality" type="number" min="1" max="5" defaultValue={p.quality} /></Field>
                      <Field label="Speed (1–5)"><Input name="speed" type="number" min="1" max="5" defaultValue={p.speed} /></Field>
                      {adapter.defaultConfig.model !== undefined && <Field label="Model" className="sm:col-span-2"><Input name="model" defaultValue={p.config.model ?? ""} /></Field>}
                      {adapter.defaultConfig.api_key_env !== undefined && <Field label="API key variable" hint="Name of the server environment variable."><Input name="api_key_env" defaultValue={p.config.api_key_env ?? ""} className="font-mono" /></Field>}
                      {adapter.defaultConfig.effort !== undefined && (
                        <Field label="Effort"><Select name="effort" defaultValue={p.config.effort ?? "medium"}>{["low", "medium", "high", "xhigh", "max"].map((e) => <option key={e}>{e}</option>)}</Select></Field>
                      )}
                      <Field label="Priority" hint="Lower runs first on ties."><Input name="priority" type="number" defaultValue={p.priority} /></Field>
                    </div>
                    <div>
                      <span className="mb-1.5 block text-xs font-medium text-muted">Capabilities this provider may serve</span>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                        {adapter.capabilities.map((c) => (
                          <label key={c} className="flex items-center gap-1.5"><input type="checkbox" name="capabilities" value={c} defaultChecked={p.capabilities.includes(c)} /> {CAPABILITY_LABELS[c]}</label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="mb-1.5 block text-xs font-medium text-muted">Prices in USD — used for estimates, budgets and cost tracking</span>
                      <div className="grid gap-3 sm:grid-cols-5">
                        {PRICE_FIELDS.filter(([k]) => adapter.generative ? k.includes("mtok") || (p.pricing as Record<string, number>)[k] != null : k === "per_render").map(([k, l]) => (
                          <Field key={k} label={l}><Input name={`price_${k}`} type="number" min="0" step="any" defaultValue={(p.pricing as Record<string, number>)[k] ?? ""} placeholder="0" /></Field>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs text-muted">{adapter.pricingSource}. Provider prices change: check them against your provider's current price list.</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={p.enabled} /> Enabled</label>
                  </fieldset>
                  {manage && (
                    <div className="flex justify-between gap-2">
                      <Button variant="danger" name="op" value="delete" formNoValidate>Remove</Button>
                      <Button name="op" value="save">Save provider</Button>
                    </div>
                  )}
                </form>
              </Card>
            );
          })}
          {!d.providers.length && <Card><p className="text-sm text-muted">No providers configured. Add one to enable production.</p></Card>}
        </div>

        <div className="space-y-6">
          <Card title="Capability coverage">
            <Table head={["Capability", "Routed to"]}>
              {CAPABILITIES.map((c) => {
                const [best, ...rest] = candidates(d.providers, c, prefer as "quality");
                return (
                  <tr key={c}>
                    <td>{CAPABILITY_LABELS[c]}</td>
                    <td>{best ? <>{best.provider.name}{rest.length > 0 && <span className="text-xs text-muted"> · fallback: {rest[0].provider.name}</span>}</>
                      : <span className="text-xs text-muted">{unavailableReason(d.providers, c)}</span>}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          <Card title="Routing">
            <form action={updateOrganizationAction} className="space-y-3">
              <input type="hidden" name="back" value="/providers" />
              <Field label="When several providers can do a task, prefer" hint="If the first choice fails, the next provider is tried automatically.">
                <Select name="routing_preference" defaultValue={prefer} disabled={!manage}>
                  <option value="quality">Highest quality</option><option value="cost">Lowest price</option><option value="speed">Fastest</option>
                </Select>
              </Field>
              {manage && <Button variant="secondary">Save</Button>}
            </form>
          </Card>

          {manage && (
            <Card title="Add a provider">
              <form action={addProviderAction} className="space-y-3">
                <Field label="Provider type">
                  <Select name="adapter">{Object.values(ADAPTERS).map((a) => <option key={a.key} value={a.key}>{a.label} — {a.capabilities.map((c) => CAPABILITY_LABELS[c]).join(", ")}</option>)}</Select>
                </Field>
                <Field label="Name" hint="Optional. Useful when adding the same provider twice with different models."><Input name="name" /></Field>
                <Button variant="secondary">Add provider</Button>
              </form>
            </Card>
          )}

          <Notice>
            <strong>Installed adapters: {Object.values(ADAPTERS).map((a) => a.label).join(", ")}.</strong> Image, video, voice, music, 3D and research
            models each need their own adapter, written against that provider's verified API. Content types that depend on them stay unavailable until then.
          </Notice>
        </div>
      </div>
    </>
  );
}

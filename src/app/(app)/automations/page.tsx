import Link from "next/link";
import { Badge, Button, Card, Field, Input, money, Notice, PageHeader, StatusBadge, Table, when } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { emergencyStopAction, setAutomationModeAction, updateOrganizationAction } from "@/server/actions/admin";
import { jobControlAction } from "@/server/actions/content";

const MODES = [
  { key: "assisted", label: "Assisted", text: "AI proposes; production pauses on the script or concept for you to review and edit. A human approves the final output." },
  { key: "autonomous_production", label: "Autonomous production", text: "AI runs research, strategy and production without pausing. A human approves the final output." },
  { key: "full_automation", label: "Full automation", text: "As above, and content that passes quality control with no issues at all is approved automatically, in the name of whoever enabled this mode. Anything with a warning still waits for a human." },
];

export default async function AutomationsPage() {
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    org: (await tx`select emergency_stop, emergency_stop_at, monthly_budget_usd,
                     (select coalesce(sum(amount_usd), 0) from production_costs c where c.org_id = o.id and c.created_at >= date_trunc('month', now())) as spent
                   from organizations o where id = ${ctx.org.id}`)[0],
    ws: (await tx`select w.automation_mode, w.full_automation_enabled_at, p.full_name from workspaces w left join profiles p on p.id = w.full_automation_enabled_by where w.id = ${ctx.workspace.id}`)[0],
    active: await tx`select j.id, j.title, j.status, j.current_stage, j.attempts, j.max_attempts, b.name as brand from content_jobs j join brands b on b.id = j.brand_id
                     where j.workspace_id = ${ctx.workspace.id} and j.status in ('queued', 'running') order by j.created_at`,
    failed: await tx`select j.id, j.title, j.updated_at, j.errors from content_jobs j where j.workspace_id = ${ctx.workspace.id} and j.status = 'failed' order by j.updated_at desc limit 8`,
    audit: ctx.can.manage ? await tx`select a.created_at, a.action, a.actor_kind, a.detail, p.full_name from audit_logs a left join profiles p on p.id = a.actor_id
                                     where a.org_id = ${ctx.org.id} order by a.created_at desc limit 40` : [],
  }));
  const stop = d.org.emergency_stop as boolean;

  return (
    <>
      <PageHeader title="Automations" subtitle="How much the system does on its own, and the controls that keep a human in charge." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Operating mode — ${ctx.workspace.name}`}>
            <form action={setAutomationModeAction} className="space-y-3">
              {MODES.map((m) => (
                <label key={m.key} className={`flex gap-3 rounded-lg border p-3 ${d.ws.automation_mode === m.key ? "border-accent bg-accent-soft" : "border-border"}`}>
                  <input type="radio" name="mode" value={m.key} defaultChecked={d.ws.automation_mode === m.key} disabled={!ctx.can.manage} className="mt-1" />
                  <span><span className="text-sm font-medium">{m.label}</span><span className="block text-sm text-muted">{m.text}</span></span>
                </label>
              ))}
              {d.ws.automation_mode === "full_automation" && <Notice tone="warn">Full automation was enabled by {d.ws.full_name ?? "—"} on {when(d.ws.full_automation_enabled_at)}.</Notice>}
              {ctx.can.manage ? (
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <Field label="Confirmation for full automation" hint="Type ENABLE FULL AUTOMATION to switch that mode on."><Input name="confirm" autoComplete="off" className="w-72 font-mono" /></Field>
                  <Button>Save mode</Button>
                </div>
              ) : <p className="text-xs text-muted">Only administrators can change the operating mode.</p>}
            </form>
            <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted">
              Publishing is never automatic today: there are no platform API connections, so every mode ends with a manual publishing package. Recurring,
              rule-triggered production runs are on the roadmap.
            </p>
          </Card>

          <Card title="Jobs in progress" action={<span className="text-xs text-muted">{d.active.length} active</span>}>
            {d.active.length ? (
              <Table head={["Job", "Brand", "Stage", "Status", ""]}>
                {d.active.map((j) => (
                  <tr key={j.id}>
                    <td><Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">{j.title}</Link><div className="text-xs text-muted">Attempt {j.attempts} of {j.max_attempts}</div></td>
                    <td>{j.brand}</td><td className="capitalize text-muted">{String(j.current_stage).replace(/_/g, " ")}</td><td><StatusBadge status={j.status} /></td>
                    <td className="text-right">{ctx.can.edit && <form action={jobControlAction}><input type="hidden" name="job_id" value={j.id} /><input type="hidden" name="op" value="cancel" /><button className="cursor-pointer text-xs text-danger hover:underline">Cancel</button></form>}</td>
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">No jobs are queued or running.</p>}
          </Card>

          <Card title="Error notifications">
            {d.failed.length ? (
              <ul className="space-y-3 text-sm">
                {d.failed.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:text-accent">{j.title}</Link> <span className="text-xs text-muted">· {when(j.updated_at)}</span>
                    <div className="text-xs text-danger">{(j.errors as { message: string }[]).at(-1)?.message}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No failed jobs.</p>}
            <p className="mt-3 text-xs text-muted">Failures are shown here, on the Overview and in the audit log. Email or chat alerts are not set up yet.</p>
          </Card>

          {ctx.can.manage && (
            <Card title="Audit log">
              <ul className="max-h-96 space-y-1.5 overflow-y-auto text-sm">
                {d.audit.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted">{when(a.created_at)}</span>
                    <span><span className="font-mono text-xs">{a.action}</span> <span className="text-muted">— {a.actor_kind === "system" ? "System" : a.full_name ?? "—"}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Emergency stop" action={<Badge tone={stop ? "danger" : "ok"}>{stop ? "Active" : "Off"}</Badge>}>
            <p className="text-sm leading-relaxed text-muted">
              Halts all production in the organization at once: nothing new starts, and running jobs stop after their current stage. Lifting it resumes the queue.
            </p>
            {stop && <p className="mt-2 text-xs text-danger">Activated {when(d.org.emergency_stop_at)}.</p>}
            {ctx.can.manageOrg ? (
              <form action={emergencyStopAction} className="mt-4">
                <input type="hidden" name="state" value={stop ? "off" : "on"} />
                <Button variant={stop ? "secondary" : "danger"} className={stop ? "" : "w-full border-danger bg-danger/15 py-3 font-semibold"}>{stop ? "Lift emergency stop" : "Stop all production"}</Button>
              </form>
            ) : <p className="mt-3 text-xs text-muted">Only organization administrators can use the emergency stop.</p>}
          </Card>

          <Card title="Spending limit">
            <div className="mb-3 text-sm">
              <span className="text-2xl font-semibold tabular-nums">{money(d.org.spent)}</span>
              <span className="text-muted"> spent this month{d.org.monthly_budget_usd ? ` of ${money(d.org.monthly_budget_usd)}` : ""}</span>
            </div>
            {d.org.monthly_budget_usd && (
              <div className="mb-4 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, (Number(d.org.spent) / Number(d.org.monthly_budget_usd)) * 100)}%` }} /></div>
            )}
            <form action={updateOrganizationAction} className="space-y-3">
              <input type="hidden" name="back" value="/automations" />
              <Field label="Organization monthly limit (USD)" hint="A paid step that would exceed this is refused before it runs.">
                <Input name="monthly_budget_usd" type="number" min="0" step="0.01" defaultValue={d.org.monthly_budget_usd ?? ""} placeholder="No limit" disabled={!ctx.can.manageOrg} />
              </Field>
              {ctx.can.manageOrg && <Button variant="secondary">Save limit</Button>}
            </form>
            <p className="mt-3 text-xs leading-relaxed text-muted">Brands, projects and campaigns can each carry their own limit, set on their pages. All of them are checked before every paid provider call.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

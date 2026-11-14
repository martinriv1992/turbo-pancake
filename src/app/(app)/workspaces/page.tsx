import { Badge, Button, Card, Field, Input, PageHeader, Table } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { addClientAction, createWorkspaceAction, deleteClientAction } from "@/server/actions/admin";
import { switchWorkspaceAction } from "@/server/actions/session";

export default async function WorkspacesPage() {
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    workspaces: await tx`
      select w.id, w.name, w.description, w.automation_mode,
        (select count(*) from brands b where b.workspace_id = w.id and b.status = 'active') as brands,
        (select count(*) from clients c where c.workspace_id = w.id) as clients,
        (select count(*) from content_jobs j where j.workspace_id = w.id) as jobs,
        (select count(distinct m.user_id) from memberships m where m.org_id = w.org_id and (m.workspace_id is null or m.workspace_id = w.id)) as members
      from workspaces w where w.org_id = ${ctx.org.id} order by w.created_at`,
    clients: await tx`
      select c.*, (select count(*) from brands b where b.client_id = c.id) as brands
      from clients c where c.workspace_id = ${ctx.workspace.id} order by c.created_at`,
  }));

  return (
    <>
      <PageHeader title="Workspaces" subtitle={`${ctx.org.name} groups its brands and clients into workspaces. Access can be granted per workspace or for the whole organization.`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {d.workspaces.map((w) => (
          <div key={w.id} className={`rounded-xl border bg-surface p-4 ${w.id === ctx.workspace.id ? "border-accent" : "border-border"}`}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{w.name}</h2>
              {w.id === ctx.workspace.id ? <Badge tone="accent">Current</Badge> : (
                <form action={switchWorkspaceAction}><input type="hidden" name="workspace" value={w.id} /><button className="cursor-pointer text-xs text-accent hover:underline">Switch</button></form>
              )}
            </div>
            {w.description && <p className="mt-1 text-sm text-muted">{w.description}</p>}
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-muted">
              {[["Brands", w.brands], ["Clients", w.clients], ["Assets", w.jobs], ["People", w.members]].map(([l, v]) => (
                <div key={l as string}><dd className="text-lg font-semibold tabular-nums text-text">{v as string}</dd><dt>{l as string}</dt></div>
              ))}
            </dl>
            <div className="mt-3 text-xs capitalize text-muted">Mode: {String(w.automation_mode).replace(/_/g, " ")}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card title={`Clients in ${ctx.workspace.name}`} className="lg:col-span-2">
          {d.clients.length ? (
            <div className="mb-8">
              <Table head={["Client", "Contact", "Brands", ""]}>
                {d.clients.map((c) => (
                  <tr key={c.id}>
                    <td><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.notes}</div></td>
                    <td className="text-muted">{c.contact_name}{c.contact_email ? ` · ${c.contact_email}` : ""}</td>
                    <td className="tabular-nums">{c.brands}</td>
                    <td className="text-right">
                      {ctx.can.edit && <form action={deleteClientAction}><input type="hidden" name="id" value={c.id} /><button className="cursor-pointer text-xs text-muted hover:text-danger">Remove</button></form>}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : <p className="mb-4 text-sm text-muted">No clients yet. Agencies can record the client each project is for.</p>}
          {ctx.can.edit && (
            <form action={addClientAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <Field label="Client name"><Input name="name" required /></Field>
              <Field label="Contact name"><Input name="contact_name" /></Field>
              <Field label="Contact email"><Input name="contact_email" type="email" /></Field>
              <Button variant="secondary">Add client</Button>
            </form>
          )}
        </Card>

        {ctx.can.manageOrg && (
          <Card title="New workspace">
            <form action={createWorkspaceAction} className="space-y-3">
              <Field label="Name"><Input name="name" required placeholder="e.g. Retail clients" /></Field>
              <Field label="Description"><Input name="description" /></Field>
              <Button variant="secondary">Create workspace</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

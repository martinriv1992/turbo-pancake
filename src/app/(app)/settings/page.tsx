import { Badge, Button, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { product } from "@/config/product";
import { requireContext } from "@/lib/context";
import { addMemberAction, removeMemberAction, updateOrganizationAction } from "@/server/actions/admin";
import { toggleThemeAction } from "@/server/actions/session";

const yes = (v: boolean) => (v ? <span className="text-ok">Yes</span> : <span className="text-muted">—</span>);

export default async function SettingsPage() {
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    members: await tx`
      select m.id, m.role, m.workspace_id, m.user_id, r.label, r.rank, p.full_name, p.email, w.name as workspace
      from memberships m join roles r on r.key = m.role left join profiles p on p.id = m.user_id left join workspaces w on w.id = m.workspace_id
      where m.org_id = ${ctx.org.id} order by r.rank desc, p.email`,
    roles: await tx`select * from roles order by rank desc`,
  }));

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization, team, roles and appearance." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Team">
            <Table head={["Person", "Role", "Access", ""]}>
              {d.members.map((m) => (
                <tr key={m.id}>
                  <td><div className="font-medium">{m.full_name ?? "—"}{m.user_id === ctx.userId && <span className="ml-2 text-xs text-muted">you</span>}</div><div className="text-xs text-muted">{m.email}</div></td>
                  <td>{m.label}</td>
                  <td>{m.workspace_id ? <Badge>{m.workspace}</Badge> : <Badge tone="info">Whole organization</Badge>}</td>
                  <td className="text-right">
                    {ctx.can.manage && m.user_id !== ctx.userId && (
                      <form action={removeMemberAction}><input type="hidden" name="id" value={m.id} /><button className="cursor-pointer text-xs text-muted hover:text-danger">Remove</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            {ctx.can.manage && (
              <form action={addMemberAction} className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-[1fr_180px_190px_auto] sm:items-end">
                <Field label="Email of an existing account"><Input name="email" type="email" required /></Field>
                <Field label="Role"><Select name="role" defaultValue="producer">{d.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select></Field>
                <Field label="Access">
                  <Select name="scope"><option value="workspace">Only {ctx.workspace.name}</option>{ctx.can.manageOrg && <option value="org">Whole organization</option>}</Select>
                </Field>
                <Button variant="secondary">Add member</Button>
                <p className="text-xs text-muted sm:col-span-4">The person needs to have signed up already; email invitations are not sent yet. You cannot grant a role above your own.</p>
              </form>
            )}
          </Card>

          <Card title="Roles and permissions">
            <Table head={["Role", "Edit content", "Approve", "Publish", "Manage"]}>
              {d.roles.map((r) => (
                <tr key={r.key}>
                  <td><div className="font-medium">{r.label}</div><div className="text-xs text-muted">{r.description}</div></td>
                  <td>{yes(r.can_edit)}</td><td>{yes(r.can_approve)}</td><td>{yes(r.can_publish)}</td><td>{yes(r.can_manage)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Organization">
            <form action={updateOrganizationAction} className="space-y-3">
              <Field label="Name"><Input name="name" defaultValue={ctx.org.name} disabled={!ctx.can.manageOrg} required /></Field>
              {ctx.can.manageOrg && <Button variant="secondary">Save</Button>}
            </form>
          </Card>
          <Card title="Appearance">
            <form action={toggleThemeAction}><Button variant="secondary">Switch between light and dark</Button></form>
          </Card>
          <Card title="Product identity">
            <dl className="space-y-2 text-sm [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted [&_dd]:text-right">
              <div><dt>Name</dt><dd>{product.name}</dd></div>
              <div><dt>Tagline</dt><dd>{product.tagline}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Set through the <span className="font-mono">NEXT_PUBLIC_APP_NAME</span> and <span className="font-mono">NEXT_PUBLIC_APP_TAGLINE</span> environment
              variables; colours and type live in one stylesheet. No code refers to the product by name.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

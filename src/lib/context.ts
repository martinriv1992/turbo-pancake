import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, type Db } from "./db";
import { readSession } from "./session";

export type AppContext = Awaited<ReturnType<typeof requireContext>>;

/** Signed-in user + current organization/workspace + effective permissions. Cached per request. */
export const requireContext = cache(async () => {
  const session = await readSession();
  if (!session) redirect("/login");
  const userId = session.userId;
  const db = <T>(fn: (tx: Db) => Promise<T>) => asUser(userId, fn);

  const { memberships, workspaces, profile } = await db(async (tx) => ({
    memberships: await tx`
      select m.org_id, m.workspace_id, m.role, r.label, r.rank, r.can_manage, r.can_edit, r.can_approve, r.can_publish
      from memberships m join roles r on r.key = m.role where m.user_id = ${userId}`,
    workspaces: await tx`
      select w.id, w.name, w.org_id, w.automation_mode, o.name as org_name, o.emergency_stop, o.monthly_budget_usd, o.settings
      from workspaces w join organizations o on o.id = w.org_id order by o.created_at, w.created_at`,
    profile: (await tx`select full_name, email from profiles where id = ${userId}`)[0],
  }));
  if (!memberships.length || !workspaces.length) redirect("/onboarding");

  const wanted = (await cookies()).get("ucs_ws")?.value;
  const ws = workspaces.find((w) => w.id === wanted) ?? workspaces[0];
  const mine = memberships.filter((m) => m.org_id === ws.org_id && (m.workspace_id === null || m.workspace_id === ws.id));
  const top = mine.reduce((a, b) => (b.rank > a.rank ? b : a), mine[0]);
  const orgLevel = memberships.filter((m) => m.org_id === ws.org_id && m.workspace_id === null);

  return {
    userId,
    email: session.email,
    name: (profile?.full_name as string) || session.email,
    org: {
      id: ws.org_id as string, name: ws.org_name as string, emergencyStop: ws.emergency_stop as boolean,
      monthlyBudget: ws.monthly_budget_usd as string | null, settings: (ws.settings ?? {}) as Record<string, string>,
    },
    workspace: { id: ws.id as string, name: ws.name as string, automationMode: ws.automation_mode as string },
    workspaces: workspaces.map((w) => ({ id: w.id as string, name: w.name as string, orgName: w.org_name as string })),
    role: top?.label as string,
    can: {
      edit: mine.some((m) => m.can_edit),
      approve: mine.some((m) => m.can_approve),
      publish: mine.some((m) => m.can_publish),
      manage: mine.some((m) => m.can_manage),
      manageOrg: orgLevel.some((m) => m.can_manage),
    },
    db,
  };
});

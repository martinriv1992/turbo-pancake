import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { readSession } from "@/lib/session";
import { createOrganizationAction, signOutAction } from "@/server/actions/session";

export default async function OnboardingPage() {
  if (!(await readSession())) redirect("/login");
  return (
    <AuthShell title="Create your organization" subtitle="An organization holds your workspaces, brands, team and budgets.">
      <form action={createOrganizationAction} className="space-y-4">
        <Field label="Organization name" hint="Your company, agency or your own name."><Input name="name" required autoFocus /></Field>
        <Field label="First workspace" hint="Workspaces group brands and clients. You can add more later.">
          <Input name="workspace" defaultValue="Main workspace" required />
        </Field>
        <Button className="w-full">Create organization</Button>
      </form>
      <form action={signOutAction} className="mt-6">
        <button className="cursor-pointer text-sm text-muted hover:text-text">Sign out</button>
      </form>
    </AuthShell>
  );
}

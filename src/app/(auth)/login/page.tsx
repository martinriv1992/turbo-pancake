import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { readSession } from "@/lib/session";
import { signInAction } from "@/server/actions/session";

export default async function LoginPage() {
  if (await readSession()) redirect("/");
  return (
    <AuthShell title="Sign in" subtitle="Welcome back.">
      <form action={signInAction} className="space-y-4">
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <Button className="w-full">Sign in</Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        New here? <Link href="/signup" className="text-accent hover:underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}

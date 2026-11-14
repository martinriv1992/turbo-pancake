import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { readSession } from "@/lib/session";
import { signUpAction } from "@/server/actions/session";

export default async function SignupPage() {
  if (await readSession()) redirect("/");
  return (
    <AuthShell title="Create your account" subtitle="Then set up your organization and first brand.">
      <form action={signUpAction} className="space-y-4">
        <Field label="Your name"><Input name="name" autoComplete="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
        <Button className="w-full">Create account</Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}

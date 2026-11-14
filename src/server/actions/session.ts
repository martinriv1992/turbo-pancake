"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { signIn, signUp } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { createSession, destroySession, readSession } from "@/lib/session";
import { dbMessage, fail, isRedirect, str } from "../util";

export async function signUpAction(f: FormData) {
  const r = await signUp(str(f, "email"), String(f.get("password") ?? ""), str(f, "name"));
  if (!r.ok) return fail("/signup", r.error);
  await createSession({ userId: r.userId, email: r.email });
  redirect("/onboarding");
}

export async function signInAction(f: FormData) {
  const r = await signIn(str(f, "email"), String(f.get("password") ?? ""));
  if (!r.ok) return fail("/login", r.error);
  await createSession({ userId: r.userId, email: r.email });
  redirect("/");
}

export async function signOutAction() {
  await destroySession();
  redirect("/login");
}

export async function createOrganizationAction(f: FormData) {
  const session = await readSession();
  if (!session) redirect("/login");
  const name = str(f, "name");
  if (!name) return fail("/onboarding", "Give your organization a name.");
  try {
    const [row] = await asUser(session.userId, (tx) => tx`select * from app.create_organization(${name}, ${str(f, "workspace") || "Main workspace"})`);
    (await cookies()).set("ucs_ws", row.workspace_id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  } catch (e) {
    if (isRedirect(e)) throw e;
    return fail("/onboarding", dbMessage(e));
  }
  redirect("/?ok=" + encodeURIComponent(`${name} is ready. Create your first brand to begin.`));
}

export async function switchWorkspaceAction(f: FormData) {
  (await cookies()).set("ucs_ws", str(f, "workspace"), { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function toggleThemeAction() {
  const jar = await cookies();
  const next = jar.get("ucs_theme")?.value === "light" ? "dark" : "light";
  jar.set("ucs_theme", next, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

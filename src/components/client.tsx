"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Success / error banner driven by ?ok= and ?error= (set by server actions). */
export function Flash() {
  const params = useSearchParams();
  const error = params.get("error");
  const ok = params.get("ok");
  if (!error && !ok) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-5 rounded-lg border px-4 py-3 text-sm ${error ? "border-danger/40 bg-danger/10 text-danger" : "border-ok/40 bg-ok/10 text-ok"}`}
    >
      {error ?? ok}
    </div>
  );
}

/** Re-fetches the page while a job is being produced. */
export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2.5 py-1 text-sm transition-colors ${
        active ? "bg-surface-2 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}

/** Submits its form as soon as the value changes (workspace switcher, filters). */
export function AutoSubmitSelect(props: React.ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

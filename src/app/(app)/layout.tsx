import Link from "next/link";
import { Suspense } from "react";
import { ProductMark } from "@/components/auth-shell";
import { AutoSubmitSelect, Flash, NavLink } from "@/components/client";
import { product } from "@/config/product";
import { requireContext } from "@/lib/context";
import { signOutAction, switchWorkspaceAction, toggleThemeAction } from "@/server/actions/session";

const NAV: { group: string; items: [string, string][] }[] = [
  { group: "", items: [["/", "Overview"]] },
  { group: "Organize", items: [["/workspaces", "Workspaces"], ["/brands", "Brands"], ["/brand-builder", "Brand Builder"]] },
  {
    group: "Create",
    items: [
      ["/studio/all", "Content Studio"], ["/studio/video", "Video Studio"], ["/studio/image", "Image Studio"],
      ["/studio/writing", "Writing Studio"], ["/studio/audio", "Audio Studio"], ["/studio/document", "Documents"],
      ["/campaigns", "Campaigns"],
    ],
  },
  { group: "Publish", items: [["/calendar", "Content Calendar"], ["/distribution", "Distribution"]] },
  { group: "Measure", items: [["/analytics", "Analytics"]] },
  { group: "System", items: [["/providers", "AI Providers"], ["/automations", "Automations"], ["/settings", "Settings"]] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();

  const nav = (
    <nav className="space-y-3">
      {NAV.map((g) => (
        <div key={g.group}>
          {g.group && <div className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-widest text-muted/70">{g.group}</div>}
          <div className="space-y-0.5">{g.items.map(([href, label]) => <NavLink key={href} href={href}>{label}</NavLink>)}</div>
        </div>
      ))}
    </nav>
  );

  const workspaceSwitcher = (
    <form action={switchWorkspaceAction}>
      <label className="sr-only" htmlFor="ws">Workspace</label>
      <AutoSubmitSelect
        id="ws"
        name="workspace"
        defaultValue={ctx.workspace.id}
        className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-sm font-medium focus:border-accent focus:outline-none"
      >
        {ctx.workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.orgName} / {w.name}</option>
        ))}
      </AutoSubmitSelect>
    </form>
  );

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-border bg-surface lg:flex lg:flex-col">
        <div className="sticky top-0 flex max-h-screen flex-1 flex-col overflow-y-auto p-4">
          <Link href="/" className="mb-4 flex items-center gap-2.5 px-1">
            <ProductMark size={30} />
            <span className="text-sm font-semibold leading-tight tracking-tight">{product.name}</span>
          </Link>
          <div className="mb-5">{workspaceSwitcher}</div>
          {nav}
          <div className="mt-auto space-y-2 border-t border-border pt-4 text-sm">
            <div className="px-1">
              <div className="truncate font-medium">{ctx.name}</div>
              <div className="truncate text-xs text-muted">{ctx.role} · {ctx.org.name}</div>
            </div>
            <div className="flex gap-2">
              <form action={toggleThemeAction}><button className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text">Light / dark</button></form>
              <form action={signOutAction}><button className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text">Sign out</button></form>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur lg:px-8">
          <details className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded-lg border border-border px-3 py-1.5 text-sm">Menu</summary>
            <div className="absolute left-0 top-11 z-20 max-h-[80vh] w-64 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-xl">
              <div className="mb-4">{workspaceSwitcher}</div>
              {nav}
              <form action={signOutAction} className="mt-4 border-t border-border pt-3"><button className="text-sm text-muted">Sign out</button></form>
            </div>
          </details>
          <div className="hidden text-sm text-muted lg:block">
            {ctx.org.name} <span className="mx-1 opacity-50">/</span> <span className="text-text">{ctx.workspace.name}</span>
          </div>
          {ctx.can.edit && (
            <Link href="/create" className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-accent-fg hover:opacity-90">
              Create new content
            </Link>
          )}
        </header>
        {ctx.org.emergencyStop && (
          <div role="alert" className="border-b border-danger/40 bg-danger/15 px-4 py-2.5 text-sm font-medium text-danger lg:px-8">
            Emergency stop is active: no production job will run until it is lifted in <Link href="/automations" className="underline">Automations</Link>.
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          <Suspense><Flash /></Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

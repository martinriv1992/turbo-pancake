import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { mdToHtml } from "@/lib/markdown";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="h-full rounded-xl border border-border bg-surface p-4 transition-colors hover:border-muted">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const btn = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};
type Variant = keyof typeof btn;
const btnBase = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...p} className={cx(btnBase, btn[variant], className)} />;
}
export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={cx(btnBase, btn[variant], className)} />;
}

const field = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:outline-none";
export const Input = (p: ComponentProps<"input">) => <input {...p} className={cx(field, p.className)} />;
export const Textarea = (p: ComponentProps<"textarea">) => <textarea rows={3} {...p} className={cx(field, "leading-relaxed", p.className)} />;
export const Select = (p: ComponentProps<"select">) => <select {...p} className={cx(field, "pr-8", p.className)} />;

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const tones = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
  accent: "bg-accent-soft text-accent",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

const STATUS: Record<string, [Tone, string]> = {
  queued: ["info", "Queued"], running: ["info", "In production"], paused_for_review: ["warn", "Review proposal"],
  awaiting_approval: ["warn", "Awaiting approval"], changes_requested: ["warn", "Changes requested"],
  approved: ["ok", "Approved"], rejected: ["danger", "Rejected"], failed: ["danger", "Failed"], cancelled: ["neutral", "Cancelled"],
  draft: ["neutral", "Draft"], scheduled: ["info", "Scheduled"], ready_manual: ["warn", "Ready to publish manually"],
  publishing: ["info", "Publishing"], published: ["ok", "Published (confirmed)"],
  locked: ["ok", "Locked"], active: ["ok", "Active"], in_production: ["info", "In production"], completed: ["ok", "Completed"],
  archived: ["neutral", "Archived"], paused: ["neutral", "Paused"],
  pending: ["neutral", "Pending"], done: ["ok", "Done"], skipped: ["neutral", "Skipped"],
};
export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const c = { info: "border-info/40 bg-info/10", warn: "border-warn/40 bg-warn/10", danger: "border-danger/40 bg-danger/10", ok: "border-ok/40 bg-ok/10" }[tone];
  return <div className={cx("rounded-lg border px-4 py-3 text-sm leading-relaxed", c)}>{children}</div>;
}

export function Markdown({ children }: { children: string }) {
  return <div className="prose-ucs text-sm" dangerouslySetInnerHTML={{ __html: mdToHtml(children) }} />;
}

export function BrandChip({ name, palette }: { name: string; palette?: { hex: string }[] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="flex overflow-hidden rounded-sm border border-border">
        {(palette?.length ? palette.slice(0, 3) : [{ hex: "#888888" }]).map((p, i) => (
          <span key={i} className="h-3 w-2" style={{ background: p.hex }} />
        ))}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
            {head.map((h) => <th key={h} className="px-5 py-2.5 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border [&>tr:last-child]:border-0 [&_td]:px-5 [&_td]:py-3 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export const money = (v: unknown, digits = 2) => {
  const n = Number(v ?? 0);
  return n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(digits)}`;
};
export const when = (d: unknown) =>
  d ? new Date(d as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "—";
export const fileUrl = (path: string) => `/api/files?path=${encodeURIComponent(path)}`;

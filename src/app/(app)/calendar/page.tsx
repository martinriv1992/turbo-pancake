import Link from "next/link";
import { Card, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { requireContext } from "@/lib/context";

const tone: Record<string, string> = {
  published: "border-ok/50 bg-ok/10", scheduled: "border-info/50 bg-info/10", ready_manual: "border-warn/50 bg-warn/10",
  failed: "border-danger/50 bg-danger/10", draft: "border-border bg-surface-2", cancelled: "border-border bg-surface-2 opacity-60",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const ctx = await requireContext();
  const now = new Date();
  const [y, mo] = /^\d{4}-\d{2}$/.test(m ?? "") ? m!.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const next = new Date(Date.UTC(y, mo, 1));
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  const d = await ctx.db(async (tx) => ({
    pubs: await tx`
      select p.id, p.platform, p.status, coalesce(p.scheduled_at, p.created_at) as at, p.scheduled_at, j.title, b.name as brand
      from publication_jobs p join content_jobs j on j.id = p.job_id join brands b on b.id = p.brand_id
      where p.workspace_id = ${ctx.workspace.id} and coalesce(p.scheduled_at, p.created_at) >= ${first} and coalesce(p.scheduled_at, p.created_at) < ${next}
      order by at`,
    unscheduled: await tx`
      select j.id, j.title, b.name as brand from content_jobs j join brands b on b.id = j.brand_id
      where j.workspace_id = ${ctx.workspace.id} and j.status = 'approved'
        and not exists (select 1 from publication_jobs p where p.job_id = j.id) order by j.completed_at desc limit 20`,
  }));

  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = now.getUTCFullYear() === y && now.getUTCMonth() + 1 === mo ? now.getUTCDate() : -1;

  return (
    <>
      <PageHeader
        title="Content Calendar"
        subtitle="Scheduled, ready and published posts for this workspace. Times are in UTC."
        actions={
          <>
            <LinkButton href={`/calendar?m=${key(new Date(Date.UTC(y, mo - 2, 1)))}`}>Previous</LinkButton>
            <span className="min-w-36 text-center text-sm font-medium">{first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            <LinkButton href={`/calendar?m=${key(next)}`}>Next</LinkButton>
          </>
        }
      />

      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-xl border border-border bg-border" style={{ gap: 1 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
            <div key={w} className="bg-surface px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">{w}</div>
          ))}
          {cells.map((day, i) => (
            <div key={i} className={`min-h-28 p-1.5 ${day ? "bg-surface" : "bg-bg"}`}>
              {day && <div className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${day === today ? "bg-accent font-semibold text-accent-fg" : "text-muted"}`}>{day}</div>}
              <div className="space-y-1">
                {day && d.pubs.filter((p) => new Date(p.at).getUTCDate() === day).map((p) => (
                  <Link key={p.id} href={`/distribution/${p.id}`} className={`block rounded border px-1.5 py-1 text-xs leading-tight hover:border-accent ${tone[p.status] ?? tone.draft}`}>
                    <div className="flex justify-between gap-1 text-[10px] uppercase tracking-wide text-muted">
                      <span>{p.platform}</span>
                      <span>{p.scheduled_at ? new Date(p.scheduled_at).toISOString().slice(11, 16) : "unscheduled"}</span>
                    </div>
                    <div className="line-clamp-2">{p.title}</div>
                    <div className="truncate text-[10px] text-muted">{p.brand}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {["scheduled", "ready_manual", "published", "failed", "draft"].map((s) => <StatusBadge key={s} status={s} />)}
      </div>

      <Card title="Approved and not yet scheduled" className="mt-6">
        {d.unscheduled.length ? (
          <ul className="divide-y divide-border text-sm">
            {d.unscheduled.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                <span>{j.title} <span className="text-muted">· {j.brand}</span></span>
                <Link href={`/jobs/${j.id}`} className="text-accent hover:underline">Prepare for publication</Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Every approved asset has a publication package.</p>}
      </Card>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandChip, Button, Card, Field, fileUrl, Input, LinkButton, PageHeader, StatusBadge, Textarea, when } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { PLATFORMS } from "@/lib/content/catalog";
import { publicationAction } from "@/server/actions/content";

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => {
    const [p] = await tx`
      select p.*, j.title, b.name as brand, b.palette, s.handle
      from publication_jobs p join content_jobs j on j.id = p.job_id join brands b on b.id = p.brand_id
      left join social_accounts s on s.id = p.social_account_id where p.id = ${id}`;
    if (!p) return null;
    const refs = (p.asset_refs as { asset_id: string }[]).map((r) => r.asset_id);
    return {
      p,
      assets: refs.length ? await tx`select id, asset_kind, title, storage_path, body from content_assets where id in ${tx(refs)}` : [],
      results: await tx`select r.*, pr.full_name from publication_results r left join profiles pr on pr.id = r.confirmed_by where r.publication_job_id = ${id} order by r.created_at desc`,
    };
  });
  if (!d) notFound();
  const { p } = d;
  const open = ["draft", "scheduled", "ready_manual", "failed"].includes(p.status);
  const hidden = <input type="hidden" name="publication_id" value={id} />;
  const files = d.assets.filter((a) => a.storage_path);
  const log = p.log as { at: string; event: string; detail: string; by?: string }[];

  return (
    <>
      <PageHeader
        title={`${PLATFORMS.find((x) => x.key === p.platform)?.label ?? p.platform} — ${p.title}`}
        subtitle={<span className="flex flex-wrap items-center gap-3"><BrandChip name={p.brand} palette={p.palette} />{p.handle && <span>{p.handle}</span>}<span>Manual publishing package</span></span>}
        actions={<><StatusBadge status={p.status} /><LinkButton href={`/jobs/${p.job_id}`}>View content</LinkButton></>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Caption">
            <form action={publicationAction} className="space-y-3">
              {hidden}<input type="hidden" name="op" value="caption" />
              <Textarea name="caption" rows={8} defaultValue={p.caption ?? ""} disabled={!open || !ctx.can.edit} />
              {open && ctx.can.edit && <Button variant="secondary">Save caption</Button>}
            </form>
          </Card>

          <Card title="Files to publish">
            {files.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {files.map((a) => (
                  <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
                    {a.asset_kind === "image" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(a.storage_path)} alt={a.title} className="mb-2 max-h-48 w-full rounded object-contain" />
                    )}
                    {a.asset_kind === "video" && <video src={fileUrl(a.storage_path)} controls className="mb-2 max-h-48 w-full rounded" />}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.title}</span>
                      <a href={fileUrl(a.storage_path) + "&download=1"} className="shrink-0 text-accent hover:underline">Download</a>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">This is a text-only post: the caption above is the content.</p>}
          </Card>

          <Card title="Publishing log">
            <ol className="space-y-2 text-sm">
              {log.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted">{when(l.at)}</span>
                  <span><span className="font-medium capitalize">{l.event.replace(/_/g, " ")}</span> <span className="text-muted">— {l.detail}{l.by ? ` (${l.by})` : ""}</span></span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Status">
            <dl className="space-y-2 text-sm [&>div]:flex [&>div]:justify-between [&_dt]:text-muted">
              <div><dt>Scheduled</dt><dd>{when(p.scheduled_at)}</dd></div>
              <div><dt>Attempts</dt><dd>{p.attempts} of {p.max_attempts}</dd></div>
              {p.last_error && <div><dt>Last error</dt><dd className="max-w-[60%] text-right text-danger">{p.last_error}</dd></div>}
            </dl>
            {d.results.map((r) => (
              <div key={r.id} className="mt-3 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm">
                Confirmed by {r.full_name ?? "—"} on {when(r.created_at)}<br />
                <a href={r.external_url} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{r.external_url}</a>
              </div>
            ))}
          </Card>

          {open && ctx.can.publish && (
            <>
              <Card title="Confirm publication">
                <p className="mb-3 text-sm text-muted">After posting on the platform, paste the link to the live post. Only then is it recorded as published.</p>
                <form action={publicationAction} className="space-y-3">
                  {hidden}<input type="hidden" name="op" value="confirm" />
                  <Field label="Link to the live post"><Input name="external_url" type="url" placeholder="https://" required /></Field>
                  <Button>Confirm as published</Button>
                </form>
              </Card>
              <Card title="Schedule and retries">
                <form action={publicationAction} className="space-y-3">
                  {hidden}<input type="hidden" name="op" value="reschedule" />
                  <Field label="New time (UTC)"><Input type="datetime-local" name="scheduled_at" required /></Field>
                  <Button variant="secondary">{p.status === "failed" ? "Retry at this time" : "Reschedule"}</Button>
                </form>
                <form action={publicationAction} className="mt-4 space-y-3 border-t border-border pt-4">
                  {hidden}<input type="hidden" name="op" value="fail" />
                  <Field label="Record a failed attempt"><Input name="detail" placeholder="What went wrong?" required /></Field>
                  <div className="flex gap-2">
                    <Button variant="secondary">Record failure</Button>
                    <Button variant="danger" name="op" value="cancel" formNoValidate>Cancel publication</Button>
                  </div>
                </form>
              </Card>
            </>
          )}
          {open && !ctx.can.publish && <Card><p className="text-sm text-muted">Scheduling and confirming publication needs a role with publishing rights.</p></Card>}
          <Link href="/distribution" className="inline-block text-sm text-muted hover:text-text">Back to Distribution</Link>
        </div>
      </div>
    </>
  );
}

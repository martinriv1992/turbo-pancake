import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/client";
import {
  Badge, BrandChip, Button, Card, Field, fileUrl, Input, LinkButton, Markdown, money, Notice, PageHeader, StatusBadge, Textarea, when,
} from "@/components/ui";
import { requireContext } from "@/lib/context";
import { contentType, PLATFORMS, STAGE_LABELS } from "@/lib/content/catalog";
import type { StageState } from "@/lib/jobs/plan";
import { editScenesAction, editTextAction, jobControlAction, preparePublicationAction, reviewJobAction } from "@/server/actions/content";

const dot: Record<string, string> = { done: "bg-ok", running: "bg-info animate-pulse", failed: "bg-danger", skipped: "bg-border", pending: "bg-border" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => {
    const [job] = await tx`
      select j.*, b.name as brand, b.palette, p.name as project, c.name as campaign, pr.full_name as creator
      from content_jobs j join brands b on b.id = j.brand_id
      left join projects p on p.id = j.project_id left join campaigns c on c.id = j.campaign_id left join profiles pr on pr.id = j.created_by
      where j.id = ${id}`;
    if (!job) return null;
    return {
      job,
      assets: await tx`select * from content_assets where job_id = ${id} order by created_at`,
      scenes: await tx`select * from scenes where job_id = ${id} order by position`,
      media: await tx`select id, width, height, null::numeric as duration_seconds from images where job_id = ${id}
                      union all select id, width, height, duration_seconds from videos where job_id = ${id}`,
      approvals: await tx`select a.*, pr.full_name from approvals a left join profiles pr on pr.id = a.decided_by where a.job_id = ${id} order by a.created_at desc`,
      versions: await tx`select * from versions where job_id = ${id} order by created_at desc`,
      publications: await tx`select id, platform, status, scheduled_at from publication_jobs where job_id = ${id} order by created_at`,
      accounts: await tx`select id, platform, handle from social_accounts where brand_id = ${job.brand_id} order by platform`,
    };
  });
  if (!d) notFound();
  const { job } = d;
  const stages = job.stages as StageState[];
  const type = contentType(job.content_type);
  const working = job.status === "queued" || job.status === "running";
  const qc = stages.find((s) => s.key === "quality_control")?.report;
  const errors = job.errors as { at: string; message: string }[];
  const finals = d.assets.filter((a) => a.asset_kind !== "script" || a.subtype === "final");
  const proposals = d.assets.filter((a) => a.asset_kind === "script" && a.subtype !== "final");
  const editable = ctx.can.edit && ["paused_for_review", "awaiting_approval", "changes_requested"].includes(job.status);
  const hidden = <input type="hidden" name="job_id" value={id} />;
  const control = (op: string, label: string, variant: "primary" | "secondary" | "danger" | "ghost" = "secondary") => (
    <form action={jobControlAction}>{hidden}<input type="hidden" name="op" value={op} /><Button variant={variant}>{label}</Button></form>
  );
  const dims = (assetId: string) => d.media.find((m) => m.id === assetId);

  const textAsset = (a: (typeof d.assets)[number]) => (
    <Card key={a.id} title={<span className="flex items-center gap-2">{a.title} <Badge>{a.subtype === "final" ? "Final text" : a.subtype}</Badge>{a.version > 1 && <Badge tone="info">v{a.version}</Badge>}</span>}>
      <Markdown>{a.body}</Markdown>
      {editable && a.subtype !== "script" && a.subtype !== "research" && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm text-accent">Edit</summary>
          <form action={editTextAction} className="mt-3 space-y-3">
            {hidden}<input type="hidden" name="script_id" value={a.id} />
            {a.subtype === "concept" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Headline"><Input name="headline" defaultValue={a.meta?.headline ?? ""} /></Field>
                <Field label="Subline"><Input name="subline" defaultValue={a.meta?.subline ?? ""} /></Field>
                <Field label="Call to action"><Input name="cta" defaultValue={a.meta?.cta ?? ""} /></Field>
              </div>
            )}
            <Field label={a.subtype === "concept" ? "Concept notes" : "Text"}><Textarea name="body" rows={a.subtype === "final" ? 14 : 7} defaultValue={a.body} className="font-mono text-xs" /></Field>
            <Button variant="secondary">Save changes</Button>
          </form>
        </details>
      )}
    </Card>
  );

  return (
    <>
      {working && <AutoRefresh />}
      <PageHeader
        title={job.title}
        subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><BrandChip name={job.brand} palette={job.palette} /><span>{type?.label ?? job.content_type}</span>{job.project && <span>Project: {job.project}</span>}{job.campaign && <span>Campaign: {job.campaign}</span>}</span>}
        actions={<StatusBadge status={job.status} />}
      />

      {/* What needs to happen next */}
      <div className="mb-6 space-y-3">
        {working && <Notice>{job.status === "queued" ? "Queued for production." : `In production: ${STAGE_LABELS[job.current_stage] ?? job.current_stage}.`} This page updates automatically.</Notice>}

        {job.status === "paused_for_review" && (
          <Notice tone="warn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span><strong>Review the proposal.</strong> Assisted mode pauses here so you can edit the {stages.some((s) => s.key === "script") ? "script" : "concept"} before the final asset is produced.</span>
              {ctx.can.edit && <div className="flex gap-2">{control("continue", "Continue production", "primary")}{control("cancel", "Cancel", "ghost")}</div>}
            </div>
          </Notice>
        )}

        {job.status === "awaiting_approval" && (
          <Card title="Review and approve">
            {ctx.can.approve ? (
              <form action={reviewJobAction} className="space-y-3">
                {hidden}
                <Field label="Comment" hint="Required when requesting changes or rejecting."><Textarea name="comment" rows={2} /></Field>
                <div className="flex flex-wrap gap-2">
                  <Button name="decision" value="approved">Approve</Button>
                  <Button name="decision" value="changes_requested" variant="secondary">Request changes</Button>
                  <Button name="decision" value="rejected" variant="danger">Reject</Button>
                </div>
              </form>
            ) : <p className="text-sm text-muted">Waiting for someone with approval rights (creative director, client reviewer, administrator).</p>}
          </Card>
        )}

        {job.status === "changes_requested" && (
          <Notice tone="warn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span><strong>Changes requested.</strong> Edit the text below and re-run quality control, or regenerate from scratch.</span>
              {ctx.can.edit && <div className="flex gap-2">{control("rerun_qc", "Re-run quality control", "primary")}{control("regenerate", "Regenerate")}</div>}
            </div>
          </Notice>
        )}

        {job.status === "failed" && (
          <Notice tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span><strong>Production failed.</strong> {errors.at(-1)?.message}</span>
              {ctx.can.edit && control("regenerate", "Retry")}
            </div>
          </Notice>
        )}

        {job.status === "approved" && (
          <Card title="Prepare for publication">
            {d.publications.length > 0 && (
              <ul className="mb-4 space-y-1.5 text-sm">
                {d.publications.map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <Link href={`/distribution/${p.id}`} className="font-medium capitalize hover:text-accent">{p.platform}</Link>
                    <StatusBadge status={p.status} />{p.scheduled_at && <span className="text-xs text-muted">{when(p.scheduled_at)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {ctx.can.edit ? (
              <form action={preparePublicationAction} className="space-y-3">
                {hidden}
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-muted">Publish to</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {d.accounts.map((a) => (
                      <label key={a.id} className="flex items-center gap-1.5"><input type="checkbox" name="targets" value={`account:${a.id}`} /> <span className="capitalize">{a.platform}</span> <span className="text-muted">{a.handle}</span></label>
                    ))}
                    {PLATFORMS.filter((p) => !d.accounts.some((a) => a.platform === p.key)).map((p) => (
                      <label key={p.key} className="flex items-center gap-1.5 text-muted"><input type="checkbox" name="targets" value={`platform:${p.key}`} /> {p.label}</label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Schedule (UTC)" hint="Leave empty to make the package ready now."><Input type="datetime-local" name="scheduled_at" /></Field>
                  <Field label="Caption" hint="Leave empty to adapt one per platform."><Textarea name="caption" rows={2} /></Field>
                </div>
                <Button>Prepare publication packages</Button>
                <p className="text-xs leading-relaxed text-muted">
                  This creates a manual publishing package per platform (caption + files). Direct API publishing is not connected yet,
                  and a post is only marked as published after you confirm it with the live link.
                  {!ctx.can.publish && " Your role creates drafts; someone with publishing rights schedules them."}
                </p>
              </form>
            ) : <p className="text-sm text-muted">Approved. Someone with edit rights can prepare it for publication.</p>}
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {finals.filter((a) => a.asset_kind === "image").length > 0 && (
            <Card title="Images">
              <div className="grid gap-4 sm:grid-cols-2">
                {finals.filter((a) => a.asset_kind === "image").map((a) => (
                  <figure key={a.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(a.storage_path)} alt={a.title} className="w-full rounded-lg border border-border" />
                    <figcaption className="mt-1.5 flex justify-between gap-2 text-xs text-muted">
                      <span className="truncate">{a.title} · {dims(a.id)?.width}×{dims(a.id)?.height}</span>
                      <a href={fileUrl(a.storage_path) + "&download=1"} className="shrink-0 text-accent hover:underline">Download</a>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Card>
          )}
          {finals.filter((a) => a.asset_kind === "video").map((a) => (
            <Card key={a.id} title="Video" action={<a href={fileUrl(a.storage_path) + "&download=1"} className="text-xs text-accent hover:underline">Download MP4</a>}>
              <video src={fileUrl(a.storage_path)} controls className="mx-auto max-h-[70vh] rounded-lg border border-border" />
              <p className="mt-2 text-xs text-muted">{dims(a.id)?.width}×{dims(a.id)?.height} · {Number(dims(a.id)?.duration_seconds ?? 0)}s · {(a.meta?.notes ?? []).join(" ")}</p>
            </Card>
          ))}
          {finals.filter((a) => a.asset_kind === "audio").map((a) => (
            <Card key={a.id} title="Audio"><audio src={fileUrl(a.storage_path)} controls className="w-full" /></Card>
          ))}
          {finals.filter((a) => a.asset_kind === "document").map((a) => (
            <Card key={a.id} title="Document" action={<a href={fileUrl(a.storage_path) + "&download=1"} className="text-xs text-accent hover:underline">Download</a>}>
              <iframe src={fileUrl(a.storage_path)} title={a.title} sandbox="" className="h-[560px] w-full rounded-lg border border-border bg-white" />
              <p className="mt-2 text-xs text-muted">{(a.meta?.notes ?? []).join(" ")} <a href={fileUrl(a.storage_path)} target="_blank" className="underline">Open in a new tab</a></p>
            </Card>
          ))}
          {finals.filter((a) => a.asset_kind === "script").map(textAsset)}

          {job.status === "paused_for_review" && d.scenes.length > 0 && ctx.can.edit && (
            <Card title="Edit scenes">
              <form action={editScenesAction} className="space-y-3">
                {hidden}
                {d.scenes.map((s) => (
                  <div key={s.id} className="grid gap-2 sm:grid-cols-[160px_1fr]">
                    <Input name={`heading_${s.id}`} defaultValue={s.heading ?? ""} aria-label={`Scene ${s.position} heading`} />
                    <Textarea name={`narration_${s.id}`} defaultValue={s.narration ?? ""} rows={2} aria-label={`Scene ${s.position} narration`} />
                  </div>
                ))}
                <Button variant="secondary">Save scenes</Button>
              </form>
            </Card>
          )}

          {proposals.map(textAsset)}

          {!d.assets.length && !working && <Card><p className="text-sm text-muted">No outputs yet.</p></Card>}

          {d.versions.length > 0 && (
            <Card title="Versions" action={<span className="text-xs text-muted">Earlier states of this job's assets</span>}>
              <ul className="divide-y divide-border text-sm">
                {d.versions.map((v) => (
                  <li key={v.id} className="py-2.5">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                        <Badge>{v.asset_kind}</Badge> <span>v{v.version_no}</span> <span className="text-muted">{v.note}</span>
                        <span className="ml-auto text-xs text-muted">{when(v.created_at)}</span>
                      </summary>
                      {v.body && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs">{v.body}</pre>}
                      {v.storage_path && <a href={fileUrl(v.storage_path)} target="_blank" className="mt-2 inline-block text-xs text-accent hover:underline">Open file</a>}
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Pipeline" action={<span className="text-xs text-muted">{job.input?.workflow}</span>}>
            <ol className="space-y-3">
              {stages.map((s) => (
                <li key={s.key} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[s.status]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={s.status === "pending" || s.status === "skipped" ? "text-muted" : "font-medium"}>{STAGE_LABELS[s.key] ?? s.key}</span>
                      <span className="text-xs capitalize text-muted">{s.status}</span>
                    </div>
                    {s.provider && <div className="text-xs text-muted">{s.provider}</div>}
                    {s.note && <div className="text-xs leading-relaxed text-muted">{s.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
            {ctx.can.edit && ["queued", "running", "awaiting_approval"].includes(job.status) && (
              <div className="mt-4 border-t border-border pt-3">{job.cancel_requested ? <span className="text-xs text-muted">Cancellation requested…</span> : control("cancel", "Cancel job", "danger")}</div>
            )}
          </Card>

          {qc && (
            <Card title="Quality control" action={<Badge tone={qc.passed ? (qc.issues.length ? "warn" : "ok") : "danger"}>{qc.passed ? (qc.issues.length ? "Passed with warnings" : "Passed") : "Blocked"}</Badge>}>
              {qc.issues.length ? (
                <ul className="space-y-2 text-sm">
                  {qc.issues.map((i, n) => (
                    <li key={n} className="flex gap-2"><span className={i.severity === "error" ? "text-danger" : "text-warn"}>{i.severity === "error" ? "Error" : "Note"}</span><span className="text-muted">{i.message}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">All automated checks passed.</p>}
            </Card>
          )}

          <Card title="Details">
            <dl className="space-y-2 text-sm [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted [&_dd]:text-right">
              <div><dt>Operating mode</dt><dd className="capitalize">{String(job.operating_mode).replace(/_/g, " ")}</dd></div>
              <div><dt>Language</dt><dd>{job.input?.brief?.language}</dd></div>
              {job.input?.brief?.format && <div><dt>Format</dt><dd>{job.input.brief.format}</dd></div>}
              {job.input?.brief?.platforms?.length > 0 && <div><dt>Platforms</dt><dd className="capitalize">{job.input.brief.platforms.join(", ")}</dd></div>}
              <div><dt>Estimated cost</dt><dd className="tabular-nums">{money(job.estimated_cost_usd)}</dd></div>
              <div><dt>Actual cost</dt><dd className="tabular-nums">{money(job.actual_cost_usd)}</dd></div>
              <div><dt>Attempts</dt><dd>{job.attempts} of {job.max_attempts}</dd></div>
              <div><dt>Created</dt><dd>{job.creator ?? "—"} · {when(job.created_at)}</dd></div>
            </dl>
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 text-xs font-medium text-muted">Brief</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.input?.brief?.description}</p>
            </div>
          </Card>

          <Card title="Providers used">
            {(job.providers_used as { name: string; model: string; stage: string }[]).length ? (
              <ul className="space-y-1.5 text-sm">
                {(job.providers_used as { name: string; model: string; stage: string }[]).map((p, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="truncate">{p.name}</span><span className="shrink-0 text-xs text-muted">{STAGE_LABELS[p.stage] ?? p.stage} · {p.model}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">None yet.</p>}
          </Card>

          <Card title="Approval history">
            {d.approvals.length ? (
              <ul className="space-y-3 text-sm">
                {d.approvals.map((a) => (
                  <li key={a.id}>
                    <div className="flex items-center justify-between gap-2"><StatusBadge status={a.decision} /><span className="text-xs text-muted">{a.full_name ?? "—"} · {when(a.created_at)}</span></div>
                    {a.comment && <p className="mt-1 text-xs leading-relaxed text-muted">{a.comment}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No decisions yet.</p>}
          </Card>

          {errors.length > 0 && (
            <Card title="Errors">
              <ul className="space-y-2 text-xs">
                {errors.map((e, i) => <li key={i}><span className="text-muted">{when(e.at)}</span><div className="text-danger">{e.message}</div></li>)}
              </ul>
            </Card>
          )}
          <LinkButton href="/studio/all" variant="ghost">Back to Content Studio</LinkButton>
        </div>
      </div>
    </>
  );
}

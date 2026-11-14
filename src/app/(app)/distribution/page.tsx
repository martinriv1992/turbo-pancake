import Link from "next/link";
import { BrandChip, Card, Empty, Notice, PageHeader, StatusBadge, Table, when } from "@/components/ui";
import { requireContext } from "@/lib/context";
import { PLATFORMS } from "@/lib/content/catalog";

export default async function DistributionPage() {
  const ctx = await requireContext();
  const d = await ctx.db(async (tx) => ({
    pubs: await tx`
      select p.id, p.platform, p.status, p.scheduled_at, p.attempts, p.max_attempts, p.last_error, p.created_at,
             j.title, j.id as job_id, b.name as brand, b.palette, s.handle,
             (select external_url from publication_results r where r.publication_job_id = p.id and r.status = 'confirmed' limit 1) as url
      from publication_jobs p join content_jobs j on j.id = p.job_id join brands b on b.id = p.brand_id
      left join social_accounts s on s.id = p.social_account_id
      where p.workspace_id = ${ctx.workspace.id} order by p.created_at desc limit 200`,
    accounts: await tx`
      select s.platform, s.handle, s.connection, b.name as brand, b.id as brand_id, b.palette
      from social_accounts s join brands b on b.id = s.brand_id where s.workspace_id = ${ctx.workspace.id} order by b.name, s.platform`,
  }));
  const label = (k: string) => PLATFORMS.find((p) => p.key === k)?.label ?? k;
  const queue = d.pubs.filter((p) => ["draft", "scheduled", "ready_manual", "failed"].includes(p.status));
  const closed = d.pubs.filter((p) => ["published", "cancelled"].includes(p.status));

  const table = (rows: (typeof d.pubs)[number][]) => (
    <Table head={["Content", "Brand", "Platform", "Status", "Scheduled", ""]}>
      {rows.map((p) => (
        <tr key={p.id}>
          <td>
            <Link href={`/distribution/${p.id}`} className="font-medium hover:text-accent">{p.title}</Link>
            {p.last_error && p.status !== "published" && <div className="text-xs text-danger">Attempt {p.attempts} of {p.max_attempts}: {p.last_error}</div>}
          </td>
          <td><BrandChip name={p.brand} palette={p.palette} /></td>
          <td>{label(p.platform)} <span className="text-muted">{p.handle}</span></td>
          <td><StatusBadge status={p.status} /></td>
          <td className="whitespace-nowrap text-muted">{when(p.scheduled_at)}</td>
          <td className="text-right">
            {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Live post</a>
              : <Link href={`/distribution/${p.id}`} className="text-accent hover:underline">Open package</Link>}
          </td>
        </tr>
      ))}
    </Table>
  );

  return (
    <>
      <PageHeader title="Distribution" subtitle="Publication packages for approved content, per platform, with status, retries and logs." />
      <div className="mb-6">
        <Notice>
          <strong>Publishing is manual for now.</strong> Each package gives you the caption and files to post yourself; you then confirm with the link to the
          live post. Direct publishing through the Facebook, Instagram, YouTube, TikTok, Pinterest and LinkedIn APIs is on the roadmap and needs each
          platform's app review — nothing here is reported as published without confirmation.
        </Notice>
      </div>

      <div className="space-y-6">
        <Card title="Publishing queue" action={<span className="text-xs text-muted">{queue.length} open</span>}>
          {queue.length ? table(queue) : <p className="text-sm text-muted">Nothing waiting. Approve content and choose “Prepare for publication” on its page.</p>}
        </Card>
        {closed.length > 0 && <Card title="Published and closed">{table(closed)}</Card>}

        <Card title="Connected accounts" action={<span className="text-xs text-muted">Managed on each brand's profile</span>}>
          {d.accounts.length ? (
            <Table head={["Brand", "Platform", "Handle", "Connection"]}>
              {d.accounts.map((a, i) => (
                <tr key={i}>
                  <td><Link href={`/brands/${a.brand_id}`}><BrandChip name={a.brand} palette={a.palette} /></Link></td>
                  <td>{label(a.platform)}</td><td className="text-muted">{a.handle}</td>
                  <td className="text-muted">{a.connection === "manual" ? "Manual packages" : "API"}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty title="No accounts yet">Add a brand's social accounts on its profile page to use them as publishing targets.</Empty>}
        </Card>
      </div>
    </>
  );
}

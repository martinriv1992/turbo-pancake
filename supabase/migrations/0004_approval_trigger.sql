-- Recording an approval decision is what changes a job's status. Doing it in a trigger
-- means reviewers (who cannot edit content) can still approve, and a job can never be
-- "approved" without an approvals row naming who decided.
create function app.apply_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status into v_status from content_jobs where id = new.job_id for update;
  if v_status is distinct from 'awaiting_approval' then
    raise exception 'This content is not awaiting approval.' using errcode = 'P0001';
  end if;
  update content_jobs set
    status = new.decision,
    completed_at = case when new.decision in ('approved', 'rejected') then now() end,
    updated_at = now(),
    stages = (
      select coalesce(jsonb_agg(
        case when s ->> 'key' = 'human_approval' then
          s || jsonb_build_object(
            'status', case new.decision when 'approved' then 'done' when 'rejected' then 'failed' else 'pending' end,
            'finished_at', now(),
            'note', coalesce(new.comment, ''))
        else s end order by ord), '[]'::jsonb)
      from jsonb_array_elements(stages) with ordinality as t(s, ord))
  where id = new.job_id;
  return new;
end $$;

create trigger approvals_apply before insert on approvals
  for each row execute function app.apply_approval();

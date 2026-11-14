-- Campaign Studio: the generated plan lives on the campaign so every asset job can share it.
alter table campaigns add column strategy text;
alter table campaigns add column plan jsonb not null default '[]';   -- [{content_type, title, description, day_offset, job_id?}]
alter table campaigns add column plan_provider text;

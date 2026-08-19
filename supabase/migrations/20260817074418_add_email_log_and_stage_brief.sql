-- instructions shown to the candidate for task/interview stages
alter table public.stages add column brief text not null default '';

-- record of every candidate email (dev: only logged here; prod: also sent)
create table public.email_log (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  template text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index email_log_application_id_idx on public.email_log (application_id);

alter table public.email_log enable row level security;

create policy email_log_select on public.email_log
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and private.can_view_application(a.id, a.opening_id)
  ));
create policy email_log_staff_insert on public.email_log
  for insert to authenticated
  with check ((select private.is_staff()));

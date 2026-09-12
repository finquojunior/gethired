-- Interview reschedule requests (candidate asks for another day; staff approve or reject)
-- and an explicit no-show mark on slots.

alter table public.slots add column if not exists no_show_at timestamptz;

create table if not exists public.reschedule_requests (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  slot_id bigint references public.slots (id) on delete set null,
  stage_id bigint not null references public.stages (id) on delete cascade,
  requested_at timestamptz not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists reschedule_requests_application_id_idx on public.reschedule_requests (application_id);
-- one open request per application per stage
create unique index if not exists reschedule_requests_one_pending_idx
  on public.reschedule_requests (application_id, stage_id) where status = 'pending';

alter table public.reschedule_requests enable row level security;

drop policy if exists reschedule_requests_select on public.reschedule_requests;
create policy reschedule_requests_select on public.reschedule_requests
  for select to authenticated
  using ((select private.is_staff()) or (select private.is_member((select opening_id from public.stages s where s.id = stage_id))));

drop policy if exists reschedule_requests_staff_write on public.reschedule_requests;
create policy reschedule_requests_staff_write on public.reschedule_requests
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

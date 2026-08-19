-- system-review batch: email outbox, feedback constraint fix, UTM + max score,
-- opening metadata + auto-close, email templates, audit log, indexes.

-- email_log becomes an outbox: rows are written first, delivery is tracked
alter table public.email_log
  add column status text not null default 'sent'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  add column send_after timestamptz not null default now(),
  add column sent_at timestamptz,
  add column attempts int not null default 0,
  add column error text not null default '',
  add column ics text not null default '';

create index email_log_pending_idx on public.email_log (send_after)
  where status in ('pending', 'failed');

-- feedback: nullable stage_id defeated the unique constraint (NULLs distinct)
alter table public.feedback
  drop constraint feedback_application_id_stage_id_author_id_key;
alter table public.feedback
  add constraint feedback_application_id_stage_id_author_id_key
  unique nulls not distinct (application_id, stage_id, author_id);

-- applications: ad-source tracking + score denominator
alter table public.applications
  add column utm jsonb not null default '{}',
  add column max_score numeric;

-- openings: public metadata + scheduled auto-close
alter table public.openings
  add column location text not null default '',
  add column employment_type text not null default '',
  add column salary_range text not null default '',
  add column close_at timestamptz;

-- editable email templates ({{var}} substitution; fallback defaults live in code)
create table public.email_templates (
  key text primary key,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.email_templates
  for each row execute function private.set_updated_at();

alter table public.email_templates enable row level security;
create policy email_templates_staff_all on public.email_templates
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- audit log for staff actions not covered by stage_history
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text not null default '',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_created_at_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;
create policy audit_log_staff_select on public.audit_log
  for select to authenticated using ((select private.is_staff()));
create policy audit_log_staff_insert on public.audit_log
  for insert to authenticated with check ((select private.is_staff()));

-- query-pattern indexes
create index applications_opening_status_idx on public.applications (opening_id, status);
create index slots_starts_at_idx on public.slots (starts_at);

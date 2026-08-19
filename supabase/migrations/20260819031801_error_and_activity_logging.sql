-- system-wide error log + admin-only visibility for all logs

create table public.error_log (
  id bigint generated always as identity primary key,
  source text not null,            -- 'server' | 'client' | route/action name
  message text not null,
  stack text not null default '',
  context jsonb not null default '{}',  -- path, method, digest, user agent…
  created_at timestamptz not null default now()
);

create index error_log_created_at_idx on public.error_log (created_at);

alter table public.error_log enable row level security;
create policy error_log_admin_select on public.error_log
  for select to authenticated using ((select private.is_admin()));

-- activity log becomes admin-only (was staff-visible); candidate actions are
-- recorded with a null actor
alter table public.audit_log alter column actor_id drop not null;
drop policy audit_log_staff_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated using ((select private.is_admin()));

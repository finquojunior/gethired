-- Per-candidate copy of a task stage's settings, taken the moment they enter
-- the stage. Editing the task later only affects people moved in afterwards
-- (unless staff explicitly apply it to the current batch). Re-entering the
-- stage takes a fresh copy. Deadline = entered_at + task_days (0 = none).
create table public.task_assignments (
  application_id bigint not null references public.applications (id) on delete cascade,
  stage_id bigint not null references public.stages (id) on delete cascade,
  entered_at timestamptz not null default now(),
  task_days int not null default 0,
  brief text not null default '',
  brief_links text not null default '',
  brief_file_path text not null default '',
  submission_fields jsonb not null default '[]',
  primary key (application_id, stage_id)
);
create index task_assignments_stage_id_idx on public.task_assignments (stage_id);
create index task_assignments_brief_file_idx on public.task_assignments (brief_file_path) where brief_file_path <> '';
alter table public.task_assignments enable row level security;

create function private.snapshot_task_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_stage_id is null
     or (tg_op = 'UPDATE' and old.current_stage_id is not distinct from new.current_stage_id) then
    return null;
  end if;
  insert into public.task_assignments
    (application_id, stage_id, entered_at, task_days, brief, brief_links, brief_file_path, submission_fields)
  select new.id, s.id, now(), s.task_days, s.brief, s.brief_links, s.brief_file_path, s.submission_fields
  from public.stages s where s.id = new.current_stage_id and s.kind = 'task'
  on conflict (application_id, stage_id) do update set
    entered_at = excluded.entered_at, task_days = excluded.task_days, brief = excluded.brief,
    brief_links = excluded.brief_links, brief_file_path = excluded.brief_file_path,
    submission_fields = excluded.submission_fields;
  return null;
end;
$$;

create trigger snapshot_task_assignment after insert or update of current_stage_id on public.applications
  for each row execute function private.snapshot_task_assignment();

-- backfill: everyone who ever reached a task stage keeps exactly what they see today
insert into public.task_assignments
  (application_id, stage_id, entered_at, task_days, brief, brief_links, brief_file_path, submission_fields)
select a.id, s.id,
       coalesce((select max(h.created_at) from public.stage_history h
                  where h.application_id = a.id and h.to_stage_id = s.id), a.created_at),
       s.task_days, s.brief, s.brief_links, s.brief_file_path, s.submission_fields
from public.stages s
join public.applications a on a.opening_id = s.opening_id and (
  a.current_stage_id = s.id or exists (
    select 1 from public.stage_history h where h.application_id = a.id and h.to_stage_id = s.id))
where s.kind = 'task';

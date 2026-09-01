-- candidate yes/no on "are you doing this task?" — append-only so every
-- change of mind stays visible in the profile timeline; latest row wins
create table public.task_responses (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  stage_id bigint references public.stages (id) on delete set null,
  response text not null check (response in ('yes', 'no')),
  created_at timestamptz not null default now()
);
create index task_responses_app_idx on public.task_responses (application_id, id desc);
alter table public.task_responses enable row level security;

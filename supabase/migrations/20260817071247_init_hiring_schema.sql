-- gethired: initial hiring pipeline schema
-- Internal users authenticate via Supabase Auth; candidates never touch the DB
-- directly (server routes use the service role + portal_token).

create extension if not exists pgcrypto with schema extensions;

-- Private schema for RLS helper functions (not exposed via Data API)
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- profiles: internal users (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null check (role in ('admin', 'hr', 'dept_head', 'interviewer')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- openings
-- ---------------------------------------------------------------------------
create table public.openings (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  department text not null default '',
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'open', 'paused', 'closed')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index openings_created_by_idx on public.openings (created_by);

-- opening_members: scopes dept heads / requesters / interviewers to openings
create table public.opening_members (
  opening_id bigint not null references public.openings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null check (member_role in ('requester', 'interviewer', 'viewer')),
  primary key (opening_id, user_id)
);

create index opening_members_user_id_idx on public.opening_members (user_id);

-- ---------------------------------------------------------------------------
-- forms: versioned form definitions; the published row is what candidates see.
-- Applications reference the exact form row they answered.
-- ---------------------------------------------------------------------------
create table public.forms (
  id bigint generated always as identity primary key,
  opening_id bigint not null references public.openings (id) on delete cascade,
  version int not null default 1,
  schema jsonb not null default '{"pages": []}',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opening_id, version)
);

create index forms_opening_id_idx on public.forms (opening_id);
-- at most one published form per opening
create unique index forms_one_published_idx on public.forms (opening_id) where is_published;

-- ---------------------------------------------------------------------------
-- stages: per-opening configurable pipeline (ordered by position)
-- ---------------------------------------------------------------------------
create table public.stages (
  id bigint generated always as identity primary key,
  opening_id bigint not null references public.openings (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('screen', 'task', 'interview', 'offer')),
  position int not null default 0
);

create index stages_opening_id_idx on public.stages (opening_id);

-- ---------------------------------------------------------------------------
-- applications: one row per candidate per opening
-- ---------------------------------------------------------------------------
create table public.applications (
  id bigint generated always as identity primary key,
  opening_id bigint not null references public.openings (id) on delete cascade,
  form_id bigint not null references public.forms (id),
  name text not null,
  email text not null,
  phone text not null default '',
  resume_path text not null default '',
  answers jsonb not null default '{}',
  score numeric,
  current_stage_id bigint references public.stages (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'hired', 'rejected', 'withdrawn')),
  portal_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opening_id, email)
);

create index applications_opening_id_idx on public.applications (opening_id);
create index applications_form_id_idx on public.applications (form_id);
create index applications_current_stage_id_idx on public.applications (current_stage_id);

-- stage_history: audit trail of pipeline moves
create table public.stage_history (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  from_stage_id bigint references public.stages (id) on delete set null,
  to_stage_id bigint references public.stages (id) on delete set null,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index stage_history_application_id_idx on public.stage_history (application_id);
create index stage_history_from_stage_id_idx on public.stage_history (from_stage_id);
create index stage_history_to_stage_id_idx on public.stage_history (to_stage_id);
create index stage_history_changed_by_idx on public.stage_history (changed_by);

-- feedback: verdicts / interview feedback (one per author per stage)
create table public.feedback (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  stage_id bigint references public.stages (id) on delete set null,
  author_id uuid not null references public.profiles (id) on delete cascade,
  rating int check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, stage_id, author_id)
);

create index feedback_application_id_idx on public.feedback (application_id);
create index feedback_stage_id_idx on public.feedback (stage_id);
create index feedback_author_id_idx on public.feedback (author_id);

-- notes: free-form internal comments
create table public.notes (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index notes_application_id_idx on public.notes (application_id);
create index notes_author_id_idx on public.notes (author_id);

-- submissions: task files uploaded by candidates
create table public.submissions (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  stage_id bigint references public.stages (id) on delete set null,
  file_path text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index submissions_application_id_idx on public.submissions (application_id);
create index submissions_stage_id_idx on public.submissions (stage_id);

-- slots: interview slots; booking = atomic claim of application_id where null
create table public.slots (
  id bigint generated always as identity primary key,
  opening_id bigint not null references public.openings (id) on delete cascade,
  stage_id bigint not null references public.stages (id) on delete cascade,
  interviewer_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  duration_mins int not null default 30 check (duration_mins > 0),
  application_id bigint references public.applications (id) on delete set null,
  created_at timestamptz not null default now()
);

create index slots_opening_id_idx on public.slots (opening_id);
create index slots_stage_id_idx on public.slots (stage_id);
create index slots_interviewer_id_idx on public.slots (interviewer_id);
create index slots_application_id_idx on public.slots (application_id);
-- an application books at most one slot per stage
create unique index slots_one_booking_per_stage_idx on public.slots (application_id, stage_id)
  where application_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.openings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.forms
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.applications
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.feedback
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
-- security definer so they can read profiles/opening_members without
-- recursive RLS; they only ever answer questions about the calling user.
-- ---------------------------------------------------------------------------
create function private.user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

-- admin or hr: full pipeline access
create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() in ('admin', 'hr'), false);
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() = 'admin', false);
$$;

-- member of an opening in any capacity
create function private.is_member(p_opening_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opening_members
    where opening_id = p_opening_id and user_id = (select auth.uid())
  );
$$;

-- member who may view all of an opening's candidates (not slot-restricted)
create function private.is_opening_viewer(p_opening_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opening_members
    where opening_id = p_opening_id
      and user_id = (select auth.uid())
      and member_role in ('requester', 'viewer')
  );
$$;

-- can the current user see this application?
-- staff and opening viewers: yes; interviewers: only if they hold a slot for it
create function private.can_view_application(p_application_id bigint, p_opening_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff()
    or private.is_opening_viewer(p_opening_id)
    or exists (
      select 1 from public.slots
      where application_id = p_application_id
        and interviewer_id = (select auth.uid())
    );
$$;

revoke execute on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies (all "to authenticated"; candidates go through the service
-- role in server routes, which bypasses RLS by design)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.openings enable row level security;
alter table public.opening_members enable row level security;
alter table public.forms enable row level security;
alter table public.stages enable row level security;
alter table public.applications enable row level security;
alter table public.stage_history enable row level security;
alter table public.feedback enable row level security;
alter table public.notes enable row level security;
alter table public.submissions enable row level security;
alter table public.slots enable row level security;

-- profiles: whole team can see who's who; only admins change roles
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- openings
create policy openings_select on public.openings
  for select to authenticated
  using ((select private.is_staff()) or (select private.is_member(id)));
create policy openings_staff_write on public.openings
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- opening_members
create policy opening_members_select on public.opening_members
  for select to authenticated
  using ((select private.is_staff()) or (select private.is_member(opening_id)));
create policy opening_members_staff_write on public.opening_members
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- forms
create policy forms_select on public.forms
  for select to authenticated
  using ((select private.is_staff()) or (select private.is_member(opening_id)));
create policy forms_staff_write on public.forms
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- stages
create policy stages_select on public.stages
  for select to authenticated
  using ((select private.is_staff()) or (select private.is_member(opening_id)));
create policy stages_staff_write on public.stages
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- applications
create policy applications_select on public.applications
  for select to authenticated
  using ((select private.can_view_application(id, opening_id)));
create policy applications_staff_write on public.applications
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- stage_history: visible with the application; written by staff
create policy stage_history_select on public.stage_history
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and private.can_view_application(a.id, a.opening_id)
  ));
create policy stage_history_staff_insert on public.stage_history
  for insert to authenticated
  with check ((select private.is_staff()));

-- feedback: anyone who can view the application may read all feedback and
-- write their own
create policy feedback_select on public.feedback
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and private.can_view_application(a.id, a.opening_id)
  ));
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.applications a
      where a.id = application_id
        and private.can_view_application(a.id, a.opening_id)
    )
  );
create policy feedback_update_own on public.feedback
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- notes: same shape as feedback
create policy notes_select on public.notes
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and private.can_view_application(a.id, a.opening_id)
  ));
create policy notes_insert_own on public.notes
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.applications a
      where a.id = application_id
        and private.can_view_application(a.id, a.opening_id)
    )
  );

-- submissions: read with the application; written via service role
create policy submissions_select on public.submissions
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and private.can_view_application(a.id, a.opening_id)
  ));
create policy submissions_staff_write on public.submissions
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- slots: staff manage; members and the assigned interviewer can see them;
-- candidate booking happens via service role
create policy slots_select on public.slots
  for select to authenticated
  using (
    (select private.is_staff())
    or (select private.is_member(opening_id))
    or interviewer_id = (select auth.uid())
  );
create policy slots_staff_write on public.slots
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- storage: private buckets for resumes and task submissions
-- (all access via signed URLs / service role; no storage policies needed)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false), ('submissions', 'submissions', false)
on conflict (id) do nothing;

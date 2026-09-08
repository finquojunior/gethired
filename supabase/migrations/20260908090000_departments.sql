-- Departments become a managed list; people can be assigned departments and
-- then work in (and create) every opening of those departments. openings.department
-- stays the text column every query/report already reads — the list only
-- constrains what the UI offers and what access matches on.
create table public.departments (
  id bigint generated always as identity primary key,
  name text not null unique check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

insert into public.departments (name)
select distinct department from public.openings where department <> ''
on conflict (name) do nothing;

create table public.user_departments (
  user_id uuid not null references public.profiles (id) on delete cascade,
  department_id bigint not null references public.departments (id) on delete cascade,
  primary key (user_id, department_id)
);
create index user_departments_department_id_idx on public.user_departments (department_id);

-- RLS is dormant in this app (it connects as the database owner); enabled for parity
alter table public.departments enable row level security;
alter table public.user_departments enable row level security;

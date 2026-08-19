-- LOCAL-ONLY shim of the Supabase environment so supabase/migrations/*.sql
-- run unchanged on plain Postgres. Never applied to hosted Supabase —
-- everything here already exists there. Idempotent; runs before migrations.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- minimal auth schema (Supabase Auth provides the real one)
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- minimal storage schema (Supabase Storage provides the real one)
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

-- mirror Supabase's default grants on public
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- local migration tracker
create schema if not exists private;
create table if not exists private.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

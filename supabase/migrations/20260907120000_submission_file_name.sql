-- keep the candidate's original filename so both portals can show what was uploaded
alter table public.submissions add column if not exists file_name text not null default '';

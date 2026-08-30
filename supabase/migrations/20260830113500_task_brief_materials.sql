-- task brief materials: optional document + reference links per stage
alter table public.stages add column brief_file_path text not null default '';
alter table public.stages add column brief_links text not null default '';

-- storage bucket for task brief documents
insert into storage.buckets (id, name, public)
values ('briefs', 'briefs', false)
on conflict (id) do nothing;

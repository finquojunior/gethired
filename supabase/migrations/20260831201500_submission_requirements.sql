-- admin-defined submission requirements per task stage:
-- [{id, title, kind: 'file'|'link'|'either', required: bool}, …]
alter table public.stages add column submission_fields jsonb not null default '[]';
-- which requirement a submission answers ('' = free-form extra)
alter table public.submissions add column field_id text not null default '';

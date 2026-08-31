-- free-form task submissions: any number per candidate, each titled, each a
-- file or a link — replaces the fixed submission_mode gate
alter table public.submissions add column title text not null default '';
alter table public.stages drop column submission_mode;

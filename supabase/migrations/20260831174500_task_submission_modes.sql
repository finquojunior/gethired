-- task stages choose what candidates submit: a file, a link, either, or both
alter table public.stages add column submission_mode text not null default 'file'
  check (submission_mode in ('file', 'link', 'either', 'both'));

-- submissions can now carry a link instead of (or alongside) a file
alter table public.submissions add column link_url text not null default '';

-- interview panels: additional interviewers per slot (primary stays interviewer_id)
alter table public.slots add column panel uuid[] not null default '{}';

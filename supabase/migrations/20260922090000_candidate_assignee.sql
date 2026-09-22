-- Candidate assignment: one staff member owns a candidate at a time, shown as
-- that person's colour in the pipeline. Null = unassigned, which is every
-- existing row, so nothing changes until someone assigns.
alter table public.applications
  add column assignee_id uuid references public.profiles (id) on delete set null;

create index applications_assignee_id_idx on public.applications (assignee_id);

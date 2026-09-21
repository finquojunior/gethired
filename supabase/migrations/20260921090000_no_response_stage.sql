-- "No response": a silent parking stage for candidates who stopped responding —
-- phone calls that go unanswered, and interview invitations that are never booked.
-- Entering it sends no candidate mail and is invisible in their portal; rejecting
-- *from* it sends the no_response_rejection template instead of the generic one.

alter table public.stages drop constraint if exists stages_kind_check;
alter table public.stages
  add constraint stages_kind_check
  check (kind in ('screen', 'task', 'interview', 'offer', 'task_review', 'interview_review', 'no_response'));

-- Backfill: one "No response" stage at the end of every opening that lacks one.
-- Idempotent: re-running finds it already present and inserts nothing.
insert into public.stages (opening_id, name, kind, position)
select o.id, 'No response', 'no_response',
       coalesce((select max(s.position) + 1 from public.stages s where s.opening_id = o.id), 0)
from public.openings o
where not exists (
  select 1 from public.stages s where s.opening_id = o.id and s.kind = 'no_response'
);

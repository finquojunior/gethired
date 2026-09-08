-- Review stages after task/interview stages, and an explicit "interview done" mark.

alter table public.stages drop constraint if exists stages_kind_check;
alter table public.stages
  add constraint stages_kind_check
  check (kind in ('screen', 'task', 'interview', 'offer', 'task_review', 'interview_review'));

alter table public.slots add column if not exists completed_at timestamptz;

-- Backfill: a review stage directly after every task / interview stage that lacks one.
-- Idempotent: re-running finds the review stage already in place and inserts nothing.
do $$
declare
  s record;
  nxt text;
  review_kind text;
  review_name text;
begin
  for s in
    select id, opening_id, kind, position from public.stages
    where kind in ('task', 'interview')
    order by opening_id, position desc   -- desc so shifting positions never disturbs unprocessed rows
  loop
    review_kind := s.kind || '_review';
    review_name := case s.kind when 'task' then 'Task review' else 'Interview review' end;
    select kind into nxt from public.stages
      where opening_id = s.opening_id and position > s.position
      order by position limit 1;
    if nxt is distinct from review_kind then
      update public.stages set position = position + 1
        where opening_id = s.opening_id and position > s.position;
      insert into public.stages (opening_id, name, kind, position)
        values (s.opening_id, review_name, review_kind, s.position + 1);
    end if;
  end loop;

  -- renumber 0..n-1 per opening
  update public.stages st set position = r.rn
  from (
    select id, row_number() over (partition by opening_id order by position, id) - 1 as rn
    from public.stages
  ) r
  where r.id = st.id and st.position <> r.rn;
end $$;

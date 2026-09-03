-- number of days a candidate gets to complete the task; 0 = no deadline
alter table public.stages add column task_days int not null default 0
  check (task_days >= 0 and task_days <= 365);

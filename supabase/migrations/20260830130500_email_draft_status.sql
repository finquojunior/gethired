-- rejection emails can be drafted for manual sending from the Emails tab
alter table public.email_log drop constraint email_log_status_check;
alter table public.email_log add constraint email_log_status_check
  check (status in ('draft', 'pending', 'sent', 'failed', 'cancelled'));

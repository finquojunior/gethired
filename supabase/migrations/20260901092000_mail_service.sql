-- secondary mail service (Gmail SMTP) alongside Resend:
-- record which service handled each outbox row
alter table public.email_log add column service text not null default '';

-- tiny key-value store; first key: mail_service ('resend' | 'gmail')
create table public.app_settings (
  key text primary key,
  value text not null default ''
);
alter table public.app_settings enable row level security;

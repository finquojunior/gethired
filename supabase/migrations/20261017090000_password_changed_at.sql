-- Sessions issued before this moment stop working, so a password reset signs the person out everywhere.
alter table public.profiles add column password_changed_at timestamptz;

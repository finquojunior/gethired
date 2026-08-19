-- production auth: password login for staff (cookie sessions, scrypt hashes)
alter table public.profiles add column password_hash text not null default '';

-- storage bucket for role posters
insert into storage.buckets (id, name, public)
values ('posters', 'posters', false)
on conflict (id) do nothing;

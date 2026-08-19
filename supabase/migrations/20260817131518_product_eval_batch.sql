-- product-evaluation batch: per-slot meeting links, candidate tags

alter table public.slots add column meeting_link text not null default '';

alter table public.applications add column tags text[] not null default '{}';

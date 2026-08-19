-- candidate-facing enrichment: role poster, important notes, consent capture

alter table public.openings
  add column poster_path text not null default '',
  add column notes text not null default '',
  add column consent_text text not null default '';

-- when the candidate ticked the consent box (required at submission)
alter table public.applications add column consented_at timestamptz;

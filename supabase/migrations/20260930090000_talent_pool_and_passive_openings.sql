-- Two new closing outcomes for applications and one new opening status.
--   applications.status 'pooled': the requirement was filled, the profile is kept
--     for future roles (the "talent pool" — see the Kept on file email).
--   applications.status 'on_hold': applied while the opening was passive; flipped
--     back to 'active' (with the Hiring resumed email) when the opening reopens.
--   openings.status 'passive': public and accepting applications, but not hiring
--     right now — new applicants are told so and parked on hold.
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications
  add constraint applications_status_check
  check (status in ('active', 'hired', 'rejected', 'withdrawn', 'pooled', 'on_hold'));

alter table public.openings drop constraint if exists openings_status_check;
alter table public.openings
  add constraint openings_status_check
  check (status in ('draft', 'open', 'paused', 'closed', 'passive'));

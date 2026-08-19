# gethired

End-to-end hiring pipeline for **Finquo Junior** — replaces the old
Meta-forms + WhatsApp + Excel workflow with one system: candidates apply and
track their application online; the team manages the entire funnel from
screening to hire.

Live at **hiring.finquojunior.com** · Next.js 15 + Postgres (Supabase) + Vercel

## What it does

**Candidates** (`/careers`, no account needed)
- Careers site with role posters, salary/location details, and rich-text
  descriptions; per-role links for ad campaigns (UTM source tracking built in)
- Fully customizable multi-step application forms: 12 field types (incl.
  salary in ₹), conditional logic, per-answer scoring, required consent
- Private tokenized portal: track status, book interview slots, upload task
  submissions, withdraw
- Email at every step: received, shortlisted/stage updates, task with
  instructions, interview invite, booking confirmation with calendar invite,
  reminders, offer, hired, rejection (30-min undo window)

**Staff** (`/login` → `/app`, role-based: admin / hr / dept head / interviewer)
- Dashboard: today's interviews, new applications, pending feedback, funnels
- Pipeline per opening: list + drag-and-drop board views, bulk stage moves,
  filters (stage/status/date), sorting, CSV export
- Candidate profiles: answers, inline resume preview, feedback with ratings,
  notes, tags, timeline of every event and email
- Interview scheduling: slot batches with meeting links and multi-person
  panels; everyone involved gets emailed; feedback nudges after interviews
- Form builder with live preview, versioning (applications keep the form they
  answered), and question reuse across openings
- Manual add-candidate + CSV import for walk-ins/referrals
- Reports: funnel, source performance (which ad produced which hire),
  time-to-hire
- Admin: staff management, editable email templates, error log (every error
  any user hits, auto-captured), full activity log, per-opening archive
  download (zip with all data + files) and guarded permanent deletion

## Stack

Next.js 15 (App Router) · Postgres 17 (Supabase hosted / embedded locally) ·
Supabase Storage · Resend email · Vercel · GitHub Actions cron. Zero runtime
dependencies beyond `next`, `react`, and `pg`.

## Local development

```bash
npm install
npm run db:start   # project-local Postgres (no Docker), migrations + seed
npm run dev        # http://localhost:3000
```

Sign in with `dev-admin@example.com` / `devadmin`. Emails are captured in the
Emails tab (not delivered) unless `RESEND_API_KEY` is set.

| Script | What it does |
| --- | --- |
| `npm run db:start` / `db:stop` / `db:reset` | manage the local database |
| `npm run db:check` | schema + RLS assertions on a throwaway database |
| `npm test` | unit tests (form logic, scoring, validation, rich text) |
| `node scripts/purge.mjs <days> --dry-run` | data-retention anonymization |

Migrations live in `supabase/migrations/` and apply unchanged to hosted
Supabase via `supabase db push`.

## Deployment

Full runbook: [`docs/deploy-checklist.md`](docs/deploy-checklist.md) —
Supabase setup, every required env var, first-admin creation, cron secrets,
and the post-deploy smoke test. The scheduled tick (email outbox, reminders,
auto-close) runs from `.github/workflows/cron.yml` every 15 minutes.

`GET /api/health` reports `ok`, `email_configured`, `storage_configured`.

## Docs

| File | Contents |
| --- | --- |
| [`docs/deploy-checklist.md`](docs/deploy-checklist.md) | production runbook |
| [`docs/security-audit.md`](docs/security-audit.md) | security review + accepted risks |
| [`docs/system-review.md`](docs/system-review.md) | architecture review findings |
| [`docs/design-review.md`](docs/design-review.md) | UX/design principles applied |

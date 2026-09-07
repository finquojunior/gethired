# gethired — codebase review #2 + UX betterment plan

Reviewed 2026-08-19. Each finding verified in code before listing; each fix
verified not to break callers before applying.

## A. Logical errors (real bugs, verified)

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| A1 | **Server actions cap request bodies at Next's default 1 MB** — "Add candidate" allows a 5 MB resume and CSV import allows 2 MB; both blow up past 1 MB | Staff manual-add with a normal resume fails | `serverActions.bodySizeLimit: '12mb'` in next.config |
| A2 | **Double-book race returns a 500** — the pre-claim "already booked?" check races; the partial unique index then rejects the second claim with 23505, unhandled | Candidate clicking two slots quickly sees an error page | Catch 23505 in the book route → friendly redirect |
| A3 | **Slug-collision retry can never work** — it retries INSERT inside the same transaction Postgres has already aborted (25P02) | Concurrent same-title opening creation → 500 | `on conflict (slug) do nothing` + suffix loop, no error, no abort |
| A4 | **Staff-booked interviews send no calendar invite** — candidate self-booking attaches .ics, staff book-on-behalf forgot it | Inconsistent candidate experience | Attach the same .ics |
| A5 | **close_at only enforced by the hourly cron** — between the close time and the next tick (plus 60 s page cache), a "closed" role still lists and accepts applications | Late applications on closed roles | `close_at > now()` guard in careers list, role page, and apply route |
| A6 | **Empty tag form still writes an audit row** on every accidental Enter | Log noise | Guard empty add/remove |

## B. Duplicated / dead / unwanted code (verified unused before removal)

| # | Finding | Action |
| --- | --- | --- |
| B1 | Slot-freeing + interviewer-notify logic exists in **three near-copies** (pipeline actions, cancel route, withdraw route) — the classic drift factory | Consolidated into `lib/slots.ts`; all three call it |
| B2 | `scripts/import-csv.mjs` fully superseded by the UI CSV import (same columns, same rules) with its own second CSV parser | Removed; UI import + `lib/csv.ts` are the single path |
| B3 | Packages audit: every dependency in package.json is imported somewhere (next, react ×2, pg, embedded-postgres, tailwind toolchain, types). No unused packages | None needed |
| B4 | Minor unused exports (`FILES_ROOT`, `YES_NO_OPTIONS`) | Kept — used internally; removing exports buys nothing |

## C. Over-complexity check

- `candidates/[id]/page.tsx` (~450 lines) is the biggest file; it's one screen
  of parallel queries + sections with no logic worth extracting. Left as-is —
  splitting would add files, not clarity.
- No other file exceeds ~200 lines; no speculative abstractions found (one
  helper per concept, no interfaces with single implementations).

## D. Security re-check (delta since last audit)

- `/api/errlog` accepts unauthenticated posts by design (candidate errors must
  be reportable) — size-capped, content never rendered as HTML, admin-only read.
  Accepted; rate limiting remains a pre-production platform concern.
- Team "add user" writes `auth.users` directly — dev-only path, already marked
  for replacement by Supabase invites at auth migration.
- No new injection surfaces; all new queries parameterized; new pages behind
  the staff/admin gates.

## E. UX findings & plan

| # | Finding | Fix |
| --- | --- | --- |
| E1 | **No back button anywhere**; breadcrumbs jump to parents but lose list state (filters, tabs, scroll) | `← Back` control (browser history, with sensible fallback) on every sub-page: opening detail, form, stages, team, slots, pipeline, add-candidate, candidate profile |
| E2 | **No memory of where you were** — reopening the app always lands on the dashboard | The internal shell records the last visited page; the dashboard shows "Continue where you left off → …" |
| E3 | **The fixed contact form (name/email/phone/resume) looks uneditable and unfindable** — it's built-in, but nothing says so; users hunt for its edit page | Builder now shows a locked "Contact details — asked first on every application" card explaining exactly which fields are fixed and why; the live preview renders them too, so the builder finally previews the *whole* form |
| E4 | **Builder options confuse users**: "Conditional logic" / "Scoring" jargon collapsed in unlabeled disclosures; the condition **value is a free-text box** even when the controlling question has fixed options (typo = silently broken logic) | Plain-language labels ("Show this question only when…", "Score answers (ranks candidates automatically)"), inline explanations, and the condition value becomes a **dropdown of the controller's actual options** whenever they exist |

## Order of work
1. A1–A6 bug fixes + B1–B2 consolidation
2. E1–E2 navigation
3. E3–E4 builder clarity
4. Build, tests, live verification

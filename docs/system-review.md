# gethired — senior backend/deployment review

A hostile read of the whole system as it stands (2026-08-17): the bugs a
vibecoded codebase typically hides, deployment hazards, design anomalies, and
the features the requirements missed. File references are to current code.

---

## 1. Real bugs and logic gaps (found in code, not hypothetical)

### 1.1 Booked interview slots survive stage moves and rejection
`bulkPipeline` (app/app/candidates/actions.ts) never touches `slots`. Reject a
candidate — or move them out of the interview stage — and their booked slot
stays claimed: the interviewer still has a dead meeting, the slot can never be
rebooked, and nobody is emailed. **Highest-impact logic bug in the system.**
Fix: on reject/move-out-of-interview-stage, free future slots
(`application_id = null`) and email affected parties.

### 1.2 The interviewer is never emailed at all
`book/route.ts:45` sends the confirmation (with .ics) only to the candidate.
The approved design said "confirmation email to candidate + interviewer." The
interviewer currently learns about their interview by checking the dashboard.
Same for cancellations — silent.

### 1.3 "Hired" is unreachable; "Withdrawn" is dead state
The pipeline has a Hired tab and a `hired` status, but no action anywhere sets
it. Same for `withdrawn` — no portal withdraw button, no staff action. Two of
the four terminal statuses cannot occur.

### 1.4 Deleting an interview stage silently destroys its slots — booked ones included
`slots.stage_id` is `on delete cascade`; `deleteStage` only guards on
candidates *currently in* the stage. Deleting an interview stage with future
booked interviews vaporizes them with no notification. Guard should also block
when future booked slots exist.

### 1.5 Timezone handling assumes server TZ == org TZ
- `createSlots` parses `"${date}T${from}:00"` in the **server's** local zone.
  Works on this laptop (IST); on a UTC host, HR's "10:00" becomes 15:30 IST.
- Every `toLocaleString('en-IN', …)` renders in server TZ (no `timeZone`
  option); `toISOString().slice(0,10)` shifts dates for IST evenings.
Fix: one org-timezone constant (`Asia/Kolkata`), used for both parsing slot
input (explicit offset) and all display formatting.

### 1.6 Duplicate "general" feedback rows
`feedback` has `unique (application_id, stage_id, author_id)` with a nullable
`stage_id`. Postgres treats NULLs as distinct, so when a candidate has no
current stage the upsert's `on conflict` never matches and each save inserts a
new row. Fix: `NULLS NOT DISTINCT` on the constraint (PG15+) or default the
stage.

### 1.7 Production env fallbacks fail silent, not fast
`DATABASE_URL` falls back to localhost, `APP_URL` to `http://localhost:3000`
(→ portal links in real emails would point to localhost), `EMAIL_FROM` to
`hiring@example.com`. A misconfigured deploy would *run* and quietly do the
wrong thing. Fix: throw at startup in production when any of these is unset.

### 1.8 Concurrency edges (low likelihood, cheap to note)
- `publishForm` assumes exactly one draft row; concurrent double-publish can
  read `draft` as undefined → crash. A `select … for update` on the draft row
  fixes it.
- `createOpening` slug uniqueness can race → raw 500. Catch 23505 and retry
  with suffix.

---

## 2. Deployment hazards (beyond the known auth stub)

| Hazard | Detail | Mitigation |
| --- | --- | --- |
| **Connection exhaustion on serverless** | `pg.Pool` per lambda instance × Vercel concurrency will blow past Supabase's direct-connection limit | Use Supabase's pooled connection string (port 6543), or move internal reads to supabase-js (which also turns RLS on) |
| **No pool error handler** | An idle-client error on `pg.Pool` emits `error`; unhandled, it can crash the process | `pool.on('error', log)` one-liner |
| **Local-disk files** | Incompatible with any multi-instance/serverless deploy (known; Supabase Storage is the plan). Note: the "swap the fs calls" comment claims one swap point, but fs code lives in **three** files (apply, task, files routes) | Extract a 20-line `lib/storage.ts` now so the migration is actually one file |
| **Cron isn't scheduled anywhere** | The reminders route exists; no `vercel.json` cron entry / scheduler config | Add on deploy; also set `CRON_SECRET` |
| **No observability** | No structured logs, no error tracker, no health endpoint | `/api/health` (one query), Sentry free tier, log emails' send failures somewhere queryable — `email_log` needs a `status` column |
| **Email sending is in-request and fire-and-forget** | Bulk reject of 50 = 50 sequential Resend HTTP calls inside one server action (timeout risk); failures only `console.error` — the candidate never gets the email and nobody knows | `email_log` is already outbox-shaped: add `sent_at`/`error`, write rows in-transaction, send from the cron (retry loop). Biggest architectural improvement available for its size |
| **No backups locally** | Local Postgres has no backup story; acceptable only until real data arrives | Hosted Supabase solves; migrate before real candidate volume |
| **Lockfile uncommitted** | Nothing is committed yet; pinning means nothing until `package-lock.json` is in git | First commit |

---

## 3. Design anomalies & alignment issues

1. **Timeline isn't chronological** (candidate profile): stage moves and
   emails are two separately-rendered lists concatenated, not merged by
   timestamp. Reads as "history, then unrelated email pile." Merge and sort.
2. **Scores have no denominator.** "Score 10" — out of what? Store/display max
   possible score per form version; otherwise sorting is the only honest use.
3. **Editing a draft's scoring silently changes comparability** between
   applicants of successive versions shown in one list. At minimum, show the
   form version per application row.
4. **Candidates orphaned by stage deletion** (`current_stage_id` → null) fall
   out of every stage tab and are only visible under "All active". Reassign to
   first stage on delete instead.
5. **Client/server validation duplication** (resume size/extensions live in
   `ApplyForm.tsx` and the apply route independently) — will drift; export one
   constant.
6. **`FILES_ROOT`/connection constants duplicated** across files (see §2).
7. **No pagination anywhere.** Fine at the stated <200/opening; the pipeline
   query already sorts server-side, so adding `limit/offset` later is trivial.
   Documented ceiling, not a bug.
8. **Always-open roles** (stated requirement!) have no support for cohorting:
   applications accumulate forever in one pipeline with no batch/cohort or
   date-window filter. This is the one *stated requirement* the current design
   under-serves.

---

## 4. Optimization notes (cheap wins only; nothing here is on fire)

- **Careers pages are `force-dynamic`** but change rarely and take Meta-ad
  bursts: `export const revalidate = 60` on `/careers` and `/careers/[slug]`
  turns ad-spike traffic into cache hits. One line each.
- Composite index `applications (opening_id, status)` when volume grows;
  `slots (starts_at)` for the cron. Not needed at current scale.
- `bulkPipeline` inserts stage history per-row in a loop; a single
  `insert … select unnest(…)` when bulk sizes grow. Fine today.
- Resume/task uploads buffer fully in memory (`arrayBuffer()`); at 5–10MB ×
  low concurrency this is fine — revisit only if limits grow.

---

## 5. Features you missed (ranked by value to your actual workflow)

1. **Mark as Hired / candidate withdraw** — closes the two dead statuses
   (§1.3). Hired should also prompt "close this opening?".
2. **Source tracking (UTM capture).** You run Meta ads; storing
   `utm_source/campaign` from the apply URL costs ~10 lines and tells you
   which ad produced which hires. Highest insight-per-effort in this list.
3. **Global candidate search + cross-opening dedupe.** Same person applying
   to multiple roles is invisible today; search by name/email across openings,
   and show "also applied to X" on the profile. Seeds a talent pool for your
   always-open roles.
4. **Interviewer feedback nudge.** After a slot's end time passes with no
   feedback row from that interviewer: one reminder email. The cron already
   exists.
5. **Email template editing.** Rejection/invite copy is hardcoded in actions;
   HR will want to change wording without a deploy. A `templates` table with
   `{{name}}/{{role}}` substitution is enough.
6. **Delayed rejection send** ("undo window" / send-at-end-of-day) — standard
   ATS courtesy feature, protects against misclicks (pairs with the outbox).
7. **Import the old Excel.** One-off CSV import of historical candidates so
   the system starts with institutional memory, not empty.
8. **Opening metadata candidates expect**: location, employment type, salary
   range on the public page.
9. **Data retention/anonymization.** Resumes and PII accumulate forever;
   a "purge rejected candidates after N months" policy is both hygiene and
   privacy posture.
10. **Staff audit log.** `stage_history` covers pipeline moves only; form
    edits, slot deletions, member changes are untracked. A single
    `audit_log(actor, action, entity, at)` table written from the actions.
11. **WhatsApp channel** (deliberately deferred earlier) — revisit after
    Meta Business verification; candidates live there.
12. **Auto-close/auto-pause openings** on a date or on N hires.

---

## 6. Suggested order of attack

1. §1.1, 1.2, 1.4 (slot lifecycle + interviewer emails) — correctness of the
   scheduling feature you already ship
2. §1.7 env fail-fast + `lib/storage.ts` extraction + pool error handler — one
   sitting, de-risks the eventual deploy
3. §1.5 timezone constant — before anyone outside IST touches a deploy
4. Hired/withdraw actions (§5.1) + UTM capture (§5.2)
5. Outbox-ify email (§2) — then delayed rejection (§5.6) falls out free
6. Everything else as demand dictates

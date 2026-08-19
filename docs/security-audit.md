# gethired — security audit

Audited 2026-08-17, whole codebase (no branch diff — pre-first-commit). Scope:
candidate-facing trust boundaries, file handling, SQL, RLS, server-action
authorization, secrets, headers, DoS surface.

## Verified safe (no action)

- **SQL injection:** every query is parameterized; grep for interpolated user
  input into SQL found none. `createSlots` builds a VALUES list of
  placeholders, values are bound.
- **Path traversal:** file serving resolves against `db/files` and rejects
  anything escaping it; stored filenames are server-generated random hex, the
  client's filename is never used in paths.
- **XSS:** all candidate-controlled text renders through React (escaped);
  emails are plain text; no `dangerouslySetInnerHTML` anywhere.
- **Hidden-answer smuggling:** server validation drops answers for fields the
  conditional logic hides, so scores/stored data can't be forged past the
  logic (unit-tested).
- **Slot booking races:** atomic claim (`where application_id is null`) — no
  double-booking; booking/cancel constrained to the token's own application,
  its current stage, and future slots. No IDOR: portal routes never accept a
  foreign application id, everything derives from the 256-bit token.
- **Server-action authorization:** every mutating action checks
  `requireStaff()` (or authenticated user for feedback/notes).
- **CSRF:** internal mutations are Next server actions (built-in origin
  checks). Portal POSTs are authenticated by the unguessable URL token itself.
- **Dependencies:** pinned exact versions, `npm audit` clean (Next patched to
  15.5.23; transitive postcss/sharp overridden).
- **Storage of validated data only:** stored `answers` are the cleaned,
  type-checked subset — unknown keys and oversized values never persist.

## Fixed in this audit

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| F1 | CSV export: candidate text beginning with `=`/`+`/`-`/`@` executes as a formula when HR opens the export in Excel | Medium | Leading formula characters prefixed with `'` in the CSV escaper |
| F2 | Public upload routes buffered the entire request body before size checks — a multi-GB POST exhausts memory | Medium | `Content-Length` rejected above limit before parsing (apply + task routes); answers JSON capped at 200 KB |
| F3 | No security headers; uploaded files served inline could be content-sniffed | Medium | Global `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` via next.config; file responses additionally get `nosniff` + `CSP: sandbox; default-src 'none'` so a disguised HTML "resume" can never execute in our origin |
| F4 | Reminder cron endpoint open when `CRON_SECRET` unset — anyone could trigger candidate emails | Low | Unset secret now refuses in production (503); wrong secret 401s |
| F5 | Booking route selected interviewer email it never used | Info | Removed |
| F6 | Enum fields (opening status, stage kind) hit DB check constraints on bad input → 500 error pages | Low | Whitelist-validated in the actions |

## Known, accepted, and pre-production items

1. **Auth is a dev stub — the deploy blocker.** Every internal route currently
   runs as a seeded admin. Before any non-local deployment, Supabase Auth must
   replace `lib/auth.ts`. This was a deliberate phase decision; nothing else
   in this audit matters until it lands.
2. **RLS is written but not yet enforced at runtime**, because the server
   connects as superuser locally. On migration, either query through
   supabase-js with the user's JWT (RLS enforces everything, policies are
   already written and tested) or keep direct Postgres and mirror the checks
   in app code. Recommendation: supabase-js for internal reads/writes; keep
   service-role only for candidate routes.
3. **Portal token in URL** (256-bit, revocable by rotation): accepted for this
   stakes level; the portal exposes only the candidate's own status. Referrer
   leakage mitigated by `Referrer-Policy` and no external links on the page.
4. **No rate limiting** on public endpoints (apply spam, task re-uploads
   filling disk). Local-only today. Pre-production: front with
   Vercel/Cloudflare protections; storage moves to Supabase with per-file
   limits already enforced.
5. **Orphaned resume files** when a submission later fails (e.g. duplicate
   email): harmless disk waste; cleanup job not warranted yet.
6. **Lockfile not yet committed** — nothing is; first commit should include
   `package-lock.json` (supply-chain pinning is only as good as the committed
   lockfile).
7. **Resume/task content is not virus-scanned.** Files are stored and served
   with a no-execute CSP, never executed server-side. If staff will open
   `.doc`/`.zip` locally at scale, add scanning at the storage layer later.

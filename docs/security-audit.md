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

## Known / accepted risks

Rewritten 2026-09-07 against the deployed code. The two sections above are the
original audit record; where they differ from this section, this section wins.

1. **Auth is real, not a stub.** `lib/auth.ts` stores scrypt password hashes,
   issues HMAC-signed `userId.expiry.sig` cookies (7 days, `httpOnly`,
   `secure` in production) and refuses to boot in production without
   `SESSION_SECRET`. Every page and server action re-verifies the cookie
   server-side; middleware is only a redirect convenience. Accepted: session
   revocation is "change the password and wait out the cookie" — there is no
   per-device session list.
2. **Authorization is enforced in app code, scoped per opening.** `admin` and
   `hr` are global. `dept_head` and `interviewer` may only act inside openings
   they are a member of (`opening_members`) or hold an interview slot in
   (`slots.interviewer_id` / `panel`); `requireOpeningAccess`,
   `requireApplicationAccess`, and `openingIdForFile` gate actions, pages, and
   file downloads. People management, settings, and deleting opening data are
   admin-only (`requireAdmin`).
3. **RLS exists but is dormant.** The policies in `supabase/migrations/` are
   applied and exercised by `npm run db:check`, but the app connects as the
   `postgres` role, which bypasses them. They are defence in depth only; the
   checks in item 2 are the real boundary. Do not add new policies expecting
   them to protect anything.
4. **Rate limiting is per serverless instance.** `lib/ratelimit.ts` is an
   in-memory fixed window used by login, public apply, both signed-upload-URL
   routes, task submit, task response, and the client error log. It blunts a
   single-instance burst, not a distributed one — Vercel WAF / bot protection
   is still the real shield (see the deploy checklist).
5. **Files live in private Supabase Storage buckets** (`lib/storage.ts`);
   local disk under `db/files` is the dev fallback only, and the app refuses to
   start on Vercel without Storage configured. Large uploads go browser →
   Storage via signed URLs; the submit request carries an HMAC of the minted
   path so a candidate cannot point at someone else's file. Orphaned uploads
   (upload succeeded, submit failed) are harmless bucket waste; no cleanup job.
6. **`X-Frame-Options` is `SAMEORIGIN`, not `DENY`** as the F3 row says. The
   staff candidate page iframes our own `/api/files` route for the resume
   preview; third-party framing is still blocked. Non-PDF downloads keep the
   `sandbox; default-src 'none'` CSP.
7. **Portal token in URL** (256-bit): unchanged and accepted. Candidate routes
   additionally send `X-Robots-Tag: noindex, nofollow`.
8. **Supply chain:** `package-lock.json` is committed, versions are pinned
   exactly, and `pg` is a runtime dependency; `postcss`/`sharp` are overridden
   to patched versions.
9. **Resume/task content is not virus-scanned.** Files are never executed
   server-side and are served with `nosniff` plus the CSP above. Add scanning at
   the storage layer if staff start opening `.doc`/`.zip` locally at scale.

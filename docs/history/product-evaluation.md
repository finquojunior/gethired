# gethired — product evaluation

An honest walkthrough of every surface (2026-08-17), evaluating what a real HR
user experiences. Three buckets: **hidden** (built, but undiscoverable),
**missing** (expected, not built), **dead-ends** (flows that stop cold).

## Verdict

The engine is solid — versioned forms, scoring, atomic booking, outbox email,
audit trail — but the product wrapped around it under-sells and under-serves
it. Four root causes make it *feel* limiting:

1. **No pulse.** The landing page is a bare openings list. Nothing answers
   "what needs my attention today?" — new applications, today's interviews,
   pending feedback, stalled candidates. Every ATS lives or dies on this
   screen, and it doesn't exist.
2. **Invisible automation.** Moving a candidate to a task/interview stage
   silently sends emails; rejection emails wait in a hidden 30-minute queue;
   reminders/nudges only fire when a cron nobody runs locally is called. The
   system does a lot — and shows none of it, so it reads as "does nothing."
3. **Single-player illusion.** Teams, interviewers, feedback nudges — all
   built — but there's no UI to create staff users, so every dropdown contains
   one person and the collaboration features look dead.
4. **HR can't act on behalf of anyone.** Can't manually add a candidate
   (walk-in / WhatsApp resume — their actual daily reality), can't book a slot
   for a candidate on the phone, can't send a one-off email, can't attach a
   file. The tool only works when candidates self-serve.

---

## Area-by-area

| Area | Grade | Assessment |
| --- | --- | --- |
| Openings | C+ | Create/edit/status/metadata work. No list filtering; closed openings clutter the list; no archive. Public-link + auto-close are good but buried in the edit form. |
| Form builder | B− | Conditional logic, scoring, versioning, live preview — genuinely strong core. But logic/scoring hide inside collapsed `<details>`; no help-text per question; no email/phone/URL/file field types; no question reuse across openings; up/down buttons instead of drag. Nothing on the page explains versioning until you hover the publish button. |
| Pipeline | C+ | Tabs, bulk actions, CSV, date filter all work. But it's a table, not a board — no kanban, no drag between stages, no sort controls, no per-row quick actions (must select + use bottom bar). Emails fired by a move are never disclosed before or after. |
| Candidate profile | B− | Rich: answers, resume, feedback, notes, timeline, cross-applications, source. But resume is a link not a preview; answers aren't editable; staff can't upload files; no way to email the candidate; portal link is a tiny footnote whose purpose is never explained. |
| Scheduling | C | Slot batches + booking + cancel work and are race-safe. But HR cannot book on behalf of a candidate; slots have no meeting link/location; no recurring templates; can't reassign an interviewer; nothing warns when you move someone to interview with zero open slots (invite email then points at an empty picker — a real dead-end). |
| Candidate portal | C+ | Status, booking, task upload, withdraw — good. But candidates can't see their own submitted answers (the approved design said they would), have no timeline, and get no company branding. |
| Communications | C | Outbox, templates, delayed rejection, nudges — strong machinery. Zero visibility: no outbox screen (email_log is DB-only), no "this will email the candidate" hints, no one-off compose, no HR notification when applications arrive. Locally, nothing periodic runs, so delayed/reminder mail silently never sends. |
| Search & reporting | D | Name/email search exists. That's all. No funnel, no time-in-stage, no source (UTM) aggregates — the data is captured and never shown. No saved views. |
| Team & users | D | Membership/roles exist in schema and Team page, but there is no UI to create users, so it's a one-person system in practice. (Auth stub is a known blocker, but a user-management page could exist now.) |
| Settings | B− | Template editing with revert + audit trail is real. Disconnected from context (no link from the email moments) and no outbox view beside it. |
| Public careers | B− | Clean, cached, metadata-rich, UTM-aware. No branding/about block, no social share/OG tags. |
| Ops | B | Health, cron, import/purge scripts, env fail-fast — but scripts are CLI-only (HR can't import a CSV via UI) and the cron has no local runner. |

---

## Hidden — built but undiscoverable

1. Candidate portal (the system's best feature) — one small link on the profile
2. Stage briefs (task instructions / interview details) — only in the Stages editor
3. Automatic emails on stage moves — no disclosure at the point of action
4. Rejection undo window — one tiny checkbox label
5. Scoring & conditional logic — collapsed disclosures in the builder
6. UTM source capture — per-profile footnote only, no aggregate anywhere
7. Interview reminders + feedback nudges — cron-only, invisible and locally inert
8. CSV import / retention purge — command-line only
9. Form versioning semantics — explained only by one caption in the builder

## Missing — ranked by how much each explains "feels limiting"

1. **Dashboard home** — today's interviews, new applications, pending
   feedback, per-opening funnel counts (the "pulse")
2. **Add candidate manually** — form + resume upload by staff (the WhatsApp
   reality)
3. **Kanban board view** with drag between stages
4. **Book/manage slots on behalf of a candidate**; meeting link per slot
5. **Outbox/emails screen** + "will email candidate" disclosure on actions +
   local dev cron ticker so scheduled mail actually moves
6. **One-off compose** (email a candidate from their profile, logged)
7. **User management page** (staff list, roles) — even before real auth
8. **Reports**: funnel, source performance, time-to-hire
9. **Resume preview pane** (inline PDF viewer)
10. Staff file attachments + editable answers on profiles
11. Slot availability warning when moving candidates into interview stages
12. Question help-text, more field types, cross-opening question reuse
13. Portal: show candidate their submitted answers (design debt)
14. Careers branding block + OG tags
15. Candidate tags / talent-pool labels

## Dead-ends found while walking

- Move to interview with no open slots → candidate emailed into an empty picker
- Team page with one user → nothing meaningful can be assigned
- Closed opening → vanishes from /careers but sits undifferentiated in the list
- Rejection email while cron never runs locally → permanently "pending"

---

## Proposed roadmap

**P0 — kill the "limiting" feeling (highest leverage per line of code)**
1. Dashboard home at `/app` (pulse: interviews today, new apps, pending
   feedback, funnel per opening)
2. Manual "Add candidate" (staff form + resume upload)
3. Emails made visible: outbox screen, disclosure text on stage-move/reject
   buttons, dev auto-ticker for the cron
4. Slot warning on interview moves + HR book-on-behalf + meeting link per slot
5. User management page (create/edit staff profiles now; auth wires in later)

**P1 — workflow depth**
6. Kanban board view (drag between stages)
7. One-off compose from profile
8. Reports page (funnel, sources, time-in-stage)
9. Inline resume preview
10. Portal shows submitted answers; careers branding

**P2 — polish & scale**
11. Question reuse/help-text/field types; tags/talent pool; CSV import via UI;
    saved views; OG tags

Recommendation: P0 is one focused build session and changes how the product
*feels* more than everything shipped so far combined.

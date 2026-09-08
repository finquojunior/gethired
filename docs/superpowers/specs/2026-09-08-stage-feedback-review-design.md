# Per-stage feedback, interview completion and review stages

Date: 2026-09-08. Status: approved by the owner in chat.

## Goal

Staff score a candidate's task (1–5 stars) and interview (1–5 stars) separately,
mark an interview as completed so the candidate is never offered slots again,
and have candidates move automatically into a review stage once the scoring is
done. The Task tab gains bulk stage moves, the pipeline list shows the latest
feedback, and the new data appears wherever it is relevant.

Constraints: live product, every change backward compatible; no new security
surface; matches the shadcn-based UI.

## Data model

Migration `supabase/migrations/20260909090000_review_stages.sql`:

1. `stages.kind` check constraint widened to
   `('screen','task','interview','offer','task_review','interview_review')`.
2. Backfill: for every opening, insert a stage named `Task review` of kind
   `task_review` directly after each `task` stage whose next stage is not
   already `task_review`; same for `Interview review` after each `interview`
   stage. Positions are renumbered 0..n-1 per opening afterwards. Idempotent
   (re-running inserts nothing).
3. `slots.completed_at timestamptz null`.

No change to `feedback`; it is already unique per (application, stage, author)
with `rating int check (1..5)`.

`DEFAULT_STAGES` becomes Applied, Shortlist, Task, Task review, Interview,
Interview review, Offer. `KINDS`/`KIND_HELP` on the Stages page gain the two
review kinds. Cloning an opening already copies stages.

## Email templates

Two new entries in `DEFAULT_TEMPLATES` (`lib/email.ts`), vars
`name, role, portal_link` (+ `org`, `support_email` injected):

- `task_review` — "Your task for {{role}} is under review": thanks, the team is
  reviewing the submission, portal link, sign-off.
- `interview_review` — "Thanks for interviewing — {{role}}": interview complete,
  under review, we will be in touch, portal link, sign-off.

`notifyStage()` maps stage kind → template: `task`→`task_assigned`,
`interview`→`interview_invite`, `task_review`→`task_review`,
`interview_review`→`interview_review`, else `stage_update` (forward only, as
today). Review templates send on any move into the stage when notify is on.

## Behaviour

### Feedback per stage

- `addFeedback` reads an optional `stageId`. It must belong to the
  application's opening (checked in SQL: `stages.opening_id = applications.opening_id`);
  otherwise the action returns `?e=forbidden` semantics via the existing
  `forbidden()`. Missing `stageId` falls back to the current stage (old forms).
- Candidate page "Feedback" card renders one form per applicable stage:
  - each `task` stage the candidate has reached (stage_history to it, current
    stage, or a submission for it): titled "Task score";
  - each `interview` stage with a slot booked for the candidate: titled
    "Interview feedback";
  - the current stage if it is neither of the above: titled "Feedback".
  Each form has a `StarRating` input (5 radio inputs named `rating`, styled as
  stars, keyboard accessible, with a "no rating" clear) and the comment field,
  and lists existing feedback for that stage from all authors.
- Existing feedback rows with `stage_id null` show under a "General" list.

### Interview completion

- New actions in `app/app/candidates/actions.ts`:
  `completeInterview(formData: slotId, applicationId, back)` sets
  `completed_at = now()` on the slot when `slot.application_id = applicationId`
  and `starts_at <= now()`; `reopenInterview` clears it. Both use
  `requireApplicationAccess`.
- Effects of `completed_at`:
  - portal: no slot picking, no cancel button; text "Your interview on {when}
    is complete — we're reviewing and will be in touch";
  - staff candidate page: booking UI hidden, badge "Completed", Reopen button;
  - Interviews page: new "To close out" list = booked slots that have ended
    and are not completed, each with Mark completed and a link to the
    candidate's feedback; completed rows show a badge;
  - opening Slots page: booked rows show Completed / Awaiting completion;
  - `freeFutureSlots` untouched (it only frees future slots).

### Auto-advance

`lib/advance.ts` exports:

- `nextReviewStage(stages, fromStageId)` — pure: given an opening's stages
  ordered by position, returns the first stage after `fromStageId` whose kind
  is the matching review kind (`task`→`task_review`, `interview`→
  `interview_review`), or null. Unit tested.
- `maybeAutoAdvance(userId, applicationId, stageId)` — loads the application
  and stage; returns early unless `current_stage_id = stageId` and the
  application is active. Rules:
  - stage kind `task`: advance when any feedback row for (application, stage)
    has a non-null rating;
  - stage kind `interview`: advance when a slot for (application, stage) has
    `completed_at` set AND any feedback row for (application, stage) has a
    non-null rating.
  Advancing calls the existing `moveApplications(userId, openingId, [id],
  reviewStageId, true)`, so history, audit and the review email all happen
  through the current path. Called from `addFeedback` and `completeInterview`.

### Task tab bulk move

`app/app/openings/[id]/task/page.tsx` candidate table becomes a form posting
to `bulkPipeline` with hidden `openingId`, `back=/app/openings/{id}/task`,
`intent=move`, a `SelectAll name="appId"` column, the stage select and the
notify checkbox, plus a Move button. No reject/hire/withdraw here.

### Latest feedback in the pipeline list

`applications/page.tsx` replaces `avg_rating`/`rating_count` with a lateral
subquery returning the newest feedback (by `updated_at`): `rating`, `comment`,
`stage name`, `author`. Column shows stars + stage name, comment/author in a
tooltip. The `feedback` sort orders by that latest rating. Board cards show the
same stars.

## Where the new data appears

| Place | Addition |
| --- | --- |
| Candidate page header | Task ★ and Interview ★ badges (latest rating per kind) next to the form score |
| Pipeline list / board | latest feedback stars + stage |
| Task tab table | Score column (latest task-stage rating + count) |
| Interviews page | "To close out" list; Completed badges; feedback stars per row |
| Opening Slots page | completion state per booked slot |
| Dashboard | line under "Interviews in the next 24h": "N interviews to close out" linking to Interviews |
| Portal | completed message; stepper includes review stages |
| Archive export | feedback rows include stage name |
| Settings | the two templates appear automatically |

## Security

All new writes go through `requireApplicationAccess` / `requireOpeningAccess`.
`stageId` and `slotId` are verified against the application in the same SQL
statement that writes. No new routes, no portal write paths changed, no new
env vars.

## Backward compatibility

- Existing candidates keep stage and history; review stages are inserted after
  their task/interview stages with positions renumbered.
- Old feedback rows are untouched and still displayed.
- `addFeedback` without `stageId` behaves as before.
- Reports, cron reminders and nudges are unaffected (review kinds behave like
  `screen` everywhere that does not know them).

## Testing

- `tests/advance.test.ts`: `nextReviewStage` picks the first matching review
  stage after the given stage, skips unrelated kinds, returns null when none.
- `tests/review-migration.test.ts` (local Postgres): after applying the
  migration twice the stage count per opening is unchanged the second time and
  positions are 0..n-1.
- Manual on the local server: score a task → candidate moves to Task review
  and `task_review` is logged; book + complete an interview + rate → moves to
  Interview review; bulk move from the Task tab; portal shows completed state;
  Stages page can create the review kinds.

## Out of scope

No-show state for interviews; per-kind rating breakdown in Reports.

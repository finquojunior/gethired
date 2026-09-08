# Per-stage Feedback, Interview Completion and Review Stages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff score tasks and interviews separately with 1–5 stars, mark interviews completed, and candidates auto-move into new review stages; the Task tab gets bulk moves and the new data shows up where it matters.

**Architecture:** Reuse the existing `feedback` table (unique per application/stage/author) — only the UI becomes per-stage. Two new stage kinds (`task_review`, `interview_review`) plus `slots.completed_at` carry the new state. Auto-advance is a private helper inside the candidates server-actions module that calls the existing `moveApplications`, so history, audit and emails go through the current path. A pure `nextReviewStage()` in `lib/advance.ts` is unit tested.

**Tech Stack:** Next.js 15 App Router, React 19 server actions, Postgres via `lib/db.ts` (`q`, `tx`), shadcn/Base UI components in `components/ui`, node:test.

**Spec:** `docs/superpowers/specs/2026-09-08-stage-feedback-review-design.md`

## Global Constraints

- Live product: every change backward compatible. Existing candidates keep stage and history; old feedback rows stay visible; `addFeedback` without `stageId` still works.
- Every new write goes through `requireApplicationAccess` / `requireOpeningAccess`; `stageId`/`slotId` are verified against the application in the same SQL that writes.
- Never export a non-action helper from a `'use server'` file (every export becomes a public endpoint). Helpers stay module-private or go in `lib/`.
- UI uses the shadcn components already in `components/ui` and the existing `SubmitButton` (defaults to `type="submit"`); plain shadcn `Button` inside forms needs `type="submit"`.
- Local DB: `npm run db:start` (port 54322, db `gethired`), `node scripts/db.mjs migrate` applies new migration files, `node scripts/seed-dev.mjs` reseeds. Dev server: `DISABLE_LOCAL_CRON=1 npx next dev -p 3002`.
- Do NOT commit the pre-existing uncommitted redesign files as part of these tasks. Stage only the files each task names (`git add <paths>`), never `git add -A`.
- Do NOT push or run `supabase db push`; production ships only after the owner's review.
- Copy rule: candidate-facing text says "under review", never "pending decision"; staff UI uses "Task score" and "Interview feedback".

---

### Task 1: Migration, stage kinds, defaults, templates

**Files:**
- Create: `supabase/migrations/20260909090000_review_stages.sql`
- Modify: `app/app/openings/actions.ts:15-21` (DEFAULT_STAGES)
- Modify: `app/app/openings/[id]/stages/page.tsx:21-27` (KINDS, KIND_HELP)
- Modify: `lib/email.ts` (DEFAULT_TEMPLATES, after `withdrawn`)
- Modify: `scripts/seed-dev.mjs:60`
- Test: `tests/email-templates.test.ts` (new)

**Interfaces:**
- Produces: stage kinds `'task_review' | 'interview_review'`; column `public.slots.completed_at timestamptz null`; templates `task_review`, `interview_review` with vars `name, role, portal_link`.

- [ ] **Step 1: Write the failing template test**

```ts
// tests/email-templates.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATES } from '../lib/email.ts';

test('review templates exist with the vars notifyStage supplies', () => {
  for (const k of ['task_review', 'interview_review']) {
    const t = DEFAULT_TEMPLATES[k];
    assert.ok(t, `${k} missing`);
    assert.deepEqual(t.vars, ['name', 'role', 'portal_link']);
    assert.match(t.body, /under review/);
    assert.match(t.body, /\{\{portal_link\}\}/);
  }
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test 2>&1 | grep -A3 "review templates"`
Expected: FAIL (`task_review missing`).

- [ ] **Step 3: Add the templates**

In `lib/email.ts`, inside `DEFAULT_TEMPLATES`, after the `withdrawn` entry:

```ts
  task_review: {
    subject: 'Your task for {{role}} is under review — {{org}}',
    body: `Hi {{name}},\n\nThanks for sending in your task for {{role}}. The team is now reviewing it and we'll get back to you with the next step.\n\nYour application status:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'portal_link'],
  },
  interview_review: {
    subject: 'Thanks for interviewing — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nThanks for taking the time to interview for {{role}}. Your interview is complete and the team is reviewing the round; we'll be in touch with the outcome.\n\nYour application status:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'portal_link'],
  },
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Write the migration**

```sql
-- supabase/migrations/20260909090000_review_stages.sql
-- Review stages after task/interview stages, and an explicit "interview done" mark.

alter table public.stages drop constraint if exists stages_kind_check;
alter table public.stages
  add constraint stages_kind_check
  check (kind in ('screen', 'task', 'interview', 'offer', 'task_review', 'interview_review'));

alter table public.slots add column if not exists completed_at timestamptz;

-- Backfill: a review stage directly after every task / interview stage that lacks one.
-- Idempotent: re-running finds the review stage already in place and inserts nothing.
do $$
declare
  s record;
  nxt text;
  review_kind text;
  review_name text;
begin
  for s in
    select id, opening_id, kind, position from public.stages
    where kind in ('task', 'interview')
    order by opening_id, position desc   -- desc so shifting positions never disturbs unprocessed rows
  loop
    review_kind := s.kind || '_review';
    review_name := case s.kind when 'task' then 'Task review' else 'Interview review' end;
    select kind into nxt from public.stages
      where opening_id = s.opening_id and position > s.position
      order by position limit 1;
    if nxt is distinct from review_kind then
      update public.stages set position = position + 1
        where opening_id = s.opening_id and position > s.position;
      insert into public.stages (opening_id, name, kind, position)
        values (s.opening_id, review_name, review_kind, s.position + 1);
    end if;
  end loop;

  -- renumber 0..n-1 per opening
  update public.stages st set position = r.rn
  from (
    select id, row_number() over (partition by opening_id order by position, id) - 1 as rn
    from public.stages
  ) r
  where r.id = st.id and st.position <> r.rn;
end $$;
```

- [ ] **Step 6: Apply locally and verify idempotence**

Run:
```bash
node scripts/db.mjs migrate
node -e "
const {Client}=require('pg');const fs=require('fs');
(async()=>{const c=new Client('postgres://postgres:postgres@127.0.0.1:54322/gethired');await c.connect();
const before=(await c.query('select count(*)::int n from public.stages')).rows[0].n;
await c.query(fs.readFileSync('supabase/migrations/20260909090000_review_stages.sql','utf8'));
const after=(await c.query('select count(*)::int n from public.stages')).rows[0].n;
const gaps=(await c.query('select opening_id from public.stages group by opening_id having max(position) <> count(*)-1 or min(position)<>0')).rows.length;
const order=(await c.query(\"select opening_id, string_agg(kind, ',' order by position) k from public.stages group by opening_id\")).rows;
console.log({before,after,gaps,order});await c.end();})()"
```
Expected: `before === after`, `gaps: 0`, every opening's kinds read `screen,screen,task,task_review,interview,interview_review,offer` (seeded openings). If the local connection string differs, take it from `scripts/db.mjs` (`DB` constant).

- [ ] **Step 7: Defaults, kinds help, seed**

`app/app/openings/actions.ts`:
```ts
const DEFAULT_STAGES: Array<[string, string]> = [
  ['Applied', 'screen'],
  ['Shortlist', 'screen'],
  ['Task', 'task'],
  ['Task review', 'task_review'],
  ['Interview', 'interview'],
  ['Interview review', 'interview_review'],
  ['Offer', 'offer'],
];
```

`app/app/openings/[id]/stages/page.tsx`:
```ts
const KINDS = ['screen', 'task', 'task_review', 'interview', 'interview_review', 'offer'];
const KIND_HELP: Record<string, string> = {
  screen: 'plain review step — moving a candidate here forward sends a short progress email',
  task: 'unlocks the Task tab; moving a candidate here emails the brief and opens submissions in their portal',
  task_review: 'where candidates land automatically once their task is scored; emails "your task is under review"',
  interview: 'enables Interview slots; moving a candidate here emails an invite to pick a slot',
  interview_review: 'where candidates land automatically once the interview is marked completed and rated; emails "thanks for interviewing"',
  offer: 'feeds the "At offer stage" dashboard count',
};
```

`scripts/seed-dev.mjs:60`:
```js
  const stageRows = [['Applied', 'screen'], ['Shortlist', 'screen'], ['Task', 'task'], ['Task review', 'task_review'], ['Interview', 'interview'], ['Interview review', 'interview_review'], ['Offer', 'offer']];
```
Check the rest of the seed for positional assumptions (it references stages by name via the `S` map — search for `S['Interview']`, `S.Offer` etc.; names are unchanged so nothing else should move).

- [ ] **Step 8: Type-check, reseed, commit**

Run: `npx tsc --noEmit 2>&1 | grep -v "^tests/"; node scripts/seed-dev.mjs | tail -3`
Expected: no app-code errors; seed prints portal URLs.

```bash
git add supabase/migrations/20260909090000_review_stages.sql app/app/openings/actions.ts "app/app/openings/[id]/stages/page.tsx" lib/email.ts scripts/seed-dev.mjs tests/email-templates.test.ts
git commit -m "stages: task_review / interview_review kinds, slot completed_at, review email templates"
```

---

### Task 2: Auto-advance rule

**Files:**
- Create: `lib/advance.ts`
- Test: `tests/advance.test.ts`
- Modify: `app/app/candidates/actions.ts` (`notifyStage` template map ~line 44; new private `maybeAutoAdvance` after `moveApplications`)

**Interfaces:**
- Produces: `nextReviewStage(stages: {id:number; kind:string; position:number}[], fromStageId: number): number | null` in `lib/advance.ts`.
- Produces (module-private, `app/app/candidates/actions.ts`): `async function maybeAutoAdvance(userId: string, applicationId: number, stageId: number): Promise<boolean>` — true when a move happened. Used by Task 3 (`addFeedback`) and Task 4 (`completeInterview`).

- [ ] **Step 1: Failing unit test**

```ts
// tests/advance.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReviewStage } from '../lib/advance.ts';

const stages = [
  { id: 1, kind: 'screen', position: 0 },
  { id: 2, kind: 'task', position: 1 },
  { id: 3, kind: 'task_review', position: 2 },
  { id: 4, kind: 'interview', position: 3 },
  { id: 5, kind: 'interview_review', position: 4 },
  { id: 6, kind: 'offer', position: 5 },
];

test('task stage advances to the first task_review after it', () => {
  assert.equal(nextReviewStage(stages, 2), 3);
});
test('interview stage advances to the first interview_review after it, skipping other kinds', () => {
  assert.equal(nextReviewStage([...stages.slice(0, 4), { id: 9, kind: 'screen', position: 4 }, stages[4]], 4), 5);
});
test('no matching review stage after it → null', () => {
  assert.equal(nextReviewStage(stages.filter((s) => s.id !== 5), 4), null);
  assert.equal(nextReviewStage(stages, 1), null); // screen never auto-advances
  assert.equal(nextReviewStage(stages, 99), null);
});
test('a review stage before the source stage does not count', () => {
  assert.equal(nextReviewStage([{ id: 3, kind: 'task_review', position: 0 }, { id: 2, kind: 'task', position: 1 }], 2), null);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test 2>&1 | grep -E "advance|Cannot find"`
Expected: fails to import `../lib/advance.ts`.

- [ ] **Step 3: Implement**

```ts
// lib/advance.ts
// Which stage a candidate is auto-moved to once a task is scored or an interview
// is completed and rated: the first matching *_review stage after the source stage.
const REVIEW_OF: Record<string, string> = { task: 'task_review', interview: 'interview_review' };

export function nextReviewStage(
  stages: { id: number; kind: string; position: number }[],
  fromStageId: number
): number | null {
  const from = stages.find((s) => s.id === fromStageId);
  const want = from && REVIEW_OF[from.kind];
  if (!from || !want) return null;
  const next = stages
    .filter((s) => s.kind === want && s.position > from.position)
    .sort((a, b) => a.position - b.position)[0];
  return next ? next.id : null;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"` → `# fail 0`.

- [ ] **Step 5: Template map and the advance helper in the actions module**

In `app/app/candidates/actions.ts`, replace the `template` ternary inside `notifyStage`:

```ts
  const KIND_TEMPLATE: Record<string, string> = {
    interview: 'interview_invite',
    task: 'task_assigned',
    task_review: 'task_review',
    interview_review: 'interview_review',
  };
  const template = KIND_TEMPLATE[stage.kind] ?? 'stage_update';
```

Add the import at the top: `import { nextReviewStage } from '@/lib/advance';`

Add after `moveApplications` (NOT exported):

```ts
/**
 * Auto-advance into the review stage once the scoring for `stageId` is done:
 * task → any rating for that stage; interview → a completed slot AND any rating.
 * Only fires while the candidate is still in that stage and active. Emails via
 * the normal move path (review templates).
 */
async function maybeAutoAdvance(userId: string, applicationId: number, stageId: number): Promise<boolean> {
  const {
    rows: [row],
  } = await q<{ opening_id: number; rated: boolean; done: boolean; kind: string }>(
    `select a.opening_id, s.kind,
            exists (select 1 from public.feedback f
                    where f.application_id = a.id and f.stage_id = s.id and f.rating is not null) as rated,
            exists (select 1 from public.slots sl
                    where sl.application_id = a.id and sl.stage_id = s.id and sl.completed_at is not null) as done
     from public.applications a
     join public.stages s on s.id = $2 and s.opening_id = a.opening_id
     where a.id = $1 and a.status = 'active' and a.current_stage_id = $2`,
    [applicationId, stageId]
  );
  if (!row || !row.rated) return false;
  if (row.kind === 'interview' && !row.done) return false;
  if (row.kind !== 'task' && row.kind !== 'interview') return false;
  const { rows: stages } = await q<{ id: number; kind: string; position: number }>(
    `select id, kind, position from public.stages where opening_id = $1 order by position`,
    [row.opening_id]
  );
  const target = nextReviewStage(stages.map((s) => ({ ...s, id: Number(s.id) })), stageId);
  if (!target) return false;
  const n = await moveApplications(userId, Number(row.opening_id), [applicationId], target, true);
  return n > 0;
}
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit 2>&1 | grep -v "^tests/"` → clean (an "unused function" is not a tsc error; Task 3 wires it).

```bash
git add lib/advance.ts tests/advance.test.ts app/app/candidates/actions.ts
git commit -m "candidates: auto-advance rule into review stages; review templates on move"
```

---

### Task 3: Per-stage feedback UI and task scores

**Files:**
- Create: `components/StarRating.tsx`
- Modify: `app/app/candidates/actions.ts` (`addFeedback`, ~line 506)
- Modify: `app/app/candidates/[id]/page.tsx` — queries (~108-170), `myFeedback` (~202), header badges (~336-346), Feedback section (~678-720)

**Interfaces:**
- Consumes: `maybeAutoAdvance(userId, applicationId, stageId)` (Task 2).
- Produces: `addFeedback` accepts optional form field `stageId`; `StarRating` props `{ name?: string; defaultValue?: number | null; label: string }`.

- [ ] **Step 1: StarRating component (5 radios styled as stars, plus clear)**

```tsx
// components/StarRating.tsx
'use client';

import { useId, useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Five radio buttons that look like stars. Submits `name`=1..5, or nothing when cleared. */
export default function StarRating({
  name = 'rating',
  defaultValue,
  label,
}: {
  name?: string;
  defaultValue?: number | null;
  label: string;
}) {
  const id = useId();
  const [value, setValue] = useState<number>(defaultValue ?? 0);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset className="flex items-center gap-1" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => setValue(n)}
            className="sr-only"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          />
          <Star
            className={cn('size-6 transition-colors', n <= shown ? 'fill-amber text-amber' : 'text-muted-foreground/40')}
            aria-hidden
          />
        </label>
      ))}
      <span className="ml-1 w-8 text-xs tabular-nums text-muted-foreground" id={id}>{value ? `${value}/5` : '—'}</span>
      {value > 0 && (
        <button type="button" onClick={() => setValue(0)} className="text-xs text-muted-foreground underline">
          clear
        </button>
      )}
    </fieldset>
  );
}
```
(`text-amber` / `fill-amber` come from the existing `--color-amber` brand token in `app/globals.css`; confirm the token name with `grep -n "amber" app/globals.css`.)

- [ ] **Step 2: `addFeedback` takes `stageId`, verifies it, then tries to advance**

Replace the body of `addFeedback`:

```ts
export async function addFeedback(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const rating = Number(formData.get('rating')) || null;
  const comment = String(formData.get('comment') ?? '').trim();
  const requested = Number(formData.get('stageId')) || null;
  // stageId must be one of this application's opening's stages; older forms send none → current stage
  const {
    rows: [app],
  } = await q<{ stage_id: number | null }>(
    `select case when $2::bigint is null then a.current_stage_id
                 else (select s.id from public.stages s where s.id = $2 and s.opening_id = a.opening_id) end as stage_id
     from public.applications a where a.id = $1`,
    [applicationId, requested]
  );
  if (requested && !app?.stage_id) forbidden();
  await q(
    `insert into public.feedback (application_id, stage_id, author_id, rating, comment)
     values ($1, $2, $3, $4, $5)
     on conflict (application_id, stage_id, author_id)
     do update set rating = excluded.rating, comment = excluded.comment, updated_at = now()`,
    [applicationId, app?.stage_id ?? null, user.id, rating, comment]
  );
  await audit(user.id, 'feedback', 'application', applicationId, { rating, stageId: app?.stage_id ?? null });
  const moved = app?.stage_id ? await maybeAutoAdvance(user.id, applicationId, Number(app.stage_id)) : false;
  revalidatePath(`/app/candidates/${applicationId}`);
  if (moved) redirect(`/app/candidates/${applicationId}?ok=auto_review`);
}
```
Import `forbidden` from `@/lib/auth` (check its export name in `lib/auth.ts`; it redirects to `/app?e=forbidden`). Add `auto_review: 'Scored — moved to the review stage and the candidate has been emailed.'` to the candidate-page flash map (`app/app/candidates/flash.ts`, the `ok` messages object — read the file for the exact shape).

Note: `unique (application_id, stage_id, author_id)` treats NULL stage_id as distinct rows; that is pre-existing behaviour and unchanged.

- [ ] **Step 3: Candidate page — data for per-stage forms**

Change the `stages` query in the `Promise.all` to include kind:
```ts
      q<{ id: number; name: string; kind: string }>(
        `select id, name, kind from public.stages where opening_id = $1 order by position`,
        [a.opening_id]
      ),
```
Change the `slots` query to include `stage_id` and `completed_at`:
```ts
      q<{ id: number; stage_id: number; starts_at: Date; duration_mins: number; stage: string; interviewer: string; completed_at: Date | null }>(
        `select sl.id, sl.stage_id, sl.starts_at, sl.duration_mins, st.name as stage, p.full_name as interviewer, sl.completed_at
         from public.slots sl
         join public.stages st on st.id = sl.stage_id
         join public.profiles p on p.id = sl.interviewer_id
         where sl.application_id = $1 order by sl.starts_at`,
        [appId]
      ),
```
Add one more query to the `Promise.all` (and a destructured name `reached`): stages the candidate has reached.
```ts
      q<{ stage_id: number }>(
        `select distinct to_stage_id as stage_id from public.stage_history where application_id = $1 and to_stage_id is not null
         union select stage_id from public.submissions where application_id = $1 and stage_id is not null`,
        [appId]
      ),
```
Replace the `myFeedback` line with the list of forms to render:
```ts
  // one feedback form per stage that can be scored: task stages reached, interview
  // stages with a booking, plus the current stage if it is neither
  const reachedIds = new Set([...reached.map((r) => Number(r.stage_id)), ...(a.current_stage_id ? [Number(a.current_stage_id)] : [])]);
  const bookedStageIds = new Set(slots.map((s) => Number(s.stage_id)));
  const scoreForms = stages
    .filter((s) => (s.kind === 'task' && reachedIds.has(Number(s.id))) || (s.kind === 'interview' && bookedStageIds.has(Number(s.id))))
    .map((s) => ({ id: Number(s.id), name: s.name, kind: s.kind, title: s.kind === 'task' ? `Task score · ${s.name}` : `Interview feedback · ${s.name}` }));
  const cur = stages.find((s) => Number(s.id) === Number(a.current_stage_id));
  if (cur && !scoreForms.some((f) => f.id === Number(cur.id))) {
    scoreForms.push({ id: Number(cur.id), name: cur.name, kind: cur.kind, title: `Feedback · ${cur.name}` });
  }
  const mine = (stageId: number) => feedback.find((f) => f.author_id === user.id && Number(f.stage_id) === stageId);
  const latestFor = (kind: string) =>
    feedback.find((f) => f.rating && stages.some((s) => Number(s.id) === Number(f.stage_id) && s.kind === kind));
```

- [ ] **Step 4: Header badges**

After the existing `score` badge in the header:
```tsx
          {latestFor('task') && (
            <Badge variant="outline" className="h-6 px-3 text-sm" title="Latest task score">
              task <span className="ml-1 text-amber">{'★'.repeat(latestFor('task')!.rating!)}</span>
            </Badge>
          )}
          {latestFor('interview') && (
            <Badge variant="outline" className="h-6 px-3 text-sm" title="Latest interview feedback">
              interview <span className="ml-1 text-amber">{'★'.repeat(latestFor('interview')!.rating!)}</span>
            </Badge>
          )}
```

- [ ] **Step 5: Feedback section — one form per scoreForms entry**

Replace the whole `<section>` starting with `<h2 ...>Feedback</h2>` up to and including its closing `</section>`:

```tsx
          <section>
            <h2 className="font-display text-lg font-semibold">Feedback</h2>
            <div className="mt-3 space-y-4">
              {scoreForms.map((sf) => {
                const my = mine(sf.id);
                const rows = feedback.filter((f) => Number(f.stage_id) === sf.id);
                return (
                  <form key={sf.id} action={addFeedback} className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <input type="hidden" name="stageId" value={sf.id} />
                    <p className="font-medium">{sf.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StarRating label={`${sf.title} rating`} defaultValue={my?.rating ?? null} />
                      <Input
                        name="comment"
                        aria-label={`${sf.title} comment`}
                        placeholder={sf.kind === 'task' ? 'What stood out in the submission…' : sf.kind === 'interview' ? 'How did the interview go…' : 'Your verdict for this stage…'}
                        defaultValue={my?.comment ?? ''}
                        className="min-w-48 flex-1"
                      />
                      <SubmitButton pendingLabel="Saving…" doneMessage={my ? 'Feedback updated' : 'Feedback saved'}>
                        {my ? 'Update' : 'Save'}
                      </SubmitButton>
                    </div>
                    {sf.kind !== 'screen' && sf.kind !== 'offer' && Number(a.current_stage_id) === sf.id && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {sf.kind === 'task'
                          ? 'Saving a star rating moves the candidate to the review stage and emails them.'
                          : 'Once the interview is marked completed and rated, the candidate moves to the review stage and is emailed.'}
                      </p>
                    )}
                    {my && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        You left this on {fmt(my.created_at)} — saving replaces it.
                      </p>
                    )}
                    {rows.length > 0 && (
                      <ul className="mt-3 space-y-2 border-t border-border pt-3">
                        {rows.map((f, i) => (
                          <li key={i} className="flex items-start justify-between gap-3">
                            <span>
                              <span className="font-medium">{f.author}</span>
                              {f.comment && <span className="text-muted-foreground"> — {f.comment}</span>}
                              <span className="block text-xs text-muted-foreground">{fmt(f.created_at)}</span>
                            </span>
                            <span className="shrink-0 text-amber">{f.rating ? '★'.repeat(f.rating) : ''}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </form>
                );
              })}
              {(() => {
                const other = feedback.filter((f) => !scoreForms.some((sf) => sf.id === Number(f.stage_id)));
                return other.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {other.map((f, i) => (
                      <li key={i} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{f.author}</span>
                          <span className="text-amber">{f.rating ? '★'.repeat(f.rating) : ''}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-line">{f.comment}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{f.stage ?? 'General'} · {fmt(f.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()}
              {scoreForms.length === 0 && feedback.length === 0 && (
                <p className="text-sm text-muted-foreground">No feedback yet.</p>
              )}
            </div>
          </section>
```
Add `import StarRating from '@/components/StarRating';`. Remove the now-unused `NativeSelect` import only if nothing else on the page uses it (the Move form and slot booking do — keep it).

- [ ] **Step 6: Verify on the dev server**

Run: `npx tsc --noEmit 2>&1 | grep -v "^tests/"` → clean. Open `http://localhost:3002/app/candidates/<id of a candidate in the Task stage>` (seed: Lakshmi Khan, id 12 in the last seed — find with `curl -s -b gh_session=... http://localhost:3002/app/openings/1/applications?stage=<task stage id>` or via the UI). Expected: a "Task score · Task" form with stars. Save 4 stars: the page reloads with the flash "Scored — moved to the review stage…", header shows "task ★★★★", stage is now "Task review", Emails tab shows a `task_review` row for the candidate.

- [ ] **Step 7: Commit**

```bash
git add components/StarRating.tsx app/app/candidates/actions.ts "app/app/candidates/[id]/page.tsx" app/app/candidates/flash.ts
git commit -m "candidates: per-stage task scores and interview feedback with star input; auto-move to Task review"
```

---

### Task 4: Interview completion

**Files:**
- Modify: `app/app/candidates/actions.ts` (new actions `completeInterview`, `reopenInterview` after `staffCancelSlot`)
- Modify: `app/app/candidates/[id]/page.tsx` — Interviews section (~583-645), `openSlots`/`noOpenSlots` (~181-198)
- Modify: `app/c/[token]/page.tsx` — booking query (~121), `interviewPast` (~180), completed card (~245)
- Modify: `app/app/interviews/page.tsx` — new "To close out" list before "Upcoming"
- Modify: `app/app/openings/[id]/slots/page.tsx` — booked rows (~82, ~245)
- Modify: `app/app/page.tsx` — one count query + a line under the 24h card
- Modify: `app/app/candidates/flash.ts` — `interview_done`, `interview_reopened` messages

**Interfaces:**
- Consumes: `maybeAutoAdvance` (Task 2).
- Produces: server actions `completeInterview(formData)` and `reopenInterview(formData)` with fields `applicationId`, `slotId`, optional `back` (must start with `/app/`).

- [ ] **Step 1: Actions**

```ts
/** Staff marks a booked interview as held. Hides slot picking for the candidate and unlocks auto-advance. */
export async function completeInterview(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const slotId = Number(formData.get('slotId'));
  const { user } = await requireApplicationAccess(applicationId);
  const back = safeBack(formData.get('back'), `/app/candidates/${applicationId}`);
  const {
    rows: [slot],
  } = await q<{ stage_id: number }>(
    `update public.slots set completed_at = now()
     where id = $1 and application_id = $2 and starts_at <= now() and completed_at is null
     returning stage_id`,
    [slotId, applicationId]
  );
  if (!slot) redirect(withParam(back, 'e', 'nothing'));
  await audit(user.id, 'interview_completed', 'application', applicationId, { slotId });
  const moved = await maybeAutoAdvance(user.id, applicationId, Number(slot.stage_id));
  redirect(withParam(back, 'ok', moved ? 'auto_review' : 'interview_done'));
}

/** Undo for a mis-click; does not move the candidate back. */
export async function reopenInterview(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const slotId = Number(formData.get('slotId'));
  const { user } = await requireApplicationAccess(applicationId);
  const back = safeBack(formData.get('back'), `/app/candidates/${applicationId}`);
  const { rowCount } = await q(
    `update public.slots set completed_at = null where id = $1 and application_id = $2 and completed_at is not null`,
    [slotId, applicationId]
  );
  if (!rowCount) redirect(withParam(back, 'e', 'nothing'));
  await audit(user.id, 'interview_reopened', 'application', applicationId, { slotId });
  redirect(withParam(back, 'ok', 'interview_reopened'));
}
```
Flash messages (`app/app/candidates/flash.ts`): `interview_done: 'Interview marked completed.'`, `interview_reopened: 'Interview reopened.'`. If the Interviews page uses a different flash helper (`components/Flash.tsx` with its own map), add the same two keys there — `grep -rn "auto_review\|slot_booked" app components` shows where the maps live.

- [ ] **Step 2: Candidate page Interviews section**

Add `completeInterview, reopenInterview` to the actions import. Replace each `<li>` in `slots.map` with:

```tsx
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                  <span>
                    <span className="font-medium">{fmt(s.starts_at)}</span>
                    <span className="text-muted-foreground"> · {s.duration_mins}m · {s.stage} · with {s.interviewer}</span>
                    {s.completed_at && <Badge variant="secondary" className="ml-2">Completed</Badge>}
                  </span>
                  <span className="flex items-center gap-2">
                    {!s.completed_at && s.starts_at <= new Date() && (
                      <form action={completeInterview}>
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <SubmitButton size="sm" pendingLabel="Saving…">Mark completed</SubmitButton>
                      </form>
                    )}
                    {s.completed_at && (
                      <form action={reopenInterview}>
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <SubmitButton variant="ghost" size="sm" pendingLabel="Saving…">Reopen</SubmitButton>
                      </form>
                    )}
                    {!s.completed_at && s.starts_at > new Date() && (
                      <form action={staffCancelSlot}>
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <SubmitButton variant="destructive" size="sm" pendingLabel="Cancelling…"
                          confirmText={`Cancel the ${fmt(s.starts_at)} interview? ${a.name} and ${s.interviewer} will be emailed.`}>
                          Cancel interview
                        </SubmitButton>
                      </form>
                    )}
                  </span>
                </li>
```
Hide staff booking once any slot for the current stage is completed: change the `openSlots` condition and `noOpenSlots` to also require `!slots.some((s) => Number(s.stage_id) === Number(a.current_stage_id) && s.completed_at)` — they already require `slots.length === 0`, which covers it (a completed slot is still a slot). Leave as is; note it in the commit message.

- [ ] **Step 3: Portal**

Booking query: add `completed_at` to the select and the row type. Replace `interviewPast`:
```ts
  const interviewPast = booking && (booking.completed_at != null || booking.starts_at.getTime() + booking.duration_mins * 60_000 < Date.now());
```
Completed card copy:
```tsx
          <CardContent>
            {booking.completed_at
              ? <>Your interview on {fmt(booking.starts_at)} is complete — thanks for your time. The team is reviewing the round and will be in touch with the outcome.</>
              : <>Your interview took place on {fmt(booking.starts_at)} — thanks for your time. We&apos;ll be in touch with the outcome.</>}
          </CardContent>
```
(`openSlots` is already `[]` whenever a booking exists, so nothing else changes.)

- [ ] **Step 4: Interviews page "To close out"**

Add a third query to the existing `Promise.all`:
```ts
    q<{ id: number; candidate: string; title: string; stage: string; starts_at: Date; slot_id: number; interviewer: string; rated: boolean }>(
      `select a.id, a.name as candidate, o.title, st.name as stage, sl.starts_at, sl.id as slot_id, p.full_name as interviewer,
              exists (select 1 from public.feedback f where f.application_id = a.id and f.stage_id = sl.stage_id and f.rating is not null) as rated
       from public.slots sl
       join public.applications a on a.id = sl.application_id
       join public.openings o on o.id = a.opening_id
       join public.stages st on st.id = sl.stage_id
       join public.profiles p on p.id = sl.interviewer_id
       where sl.completed_at is null and sl.starts_at <= now() and sl.starts_at > now() - interval '30 days'
         and a.status = 'active' and a.current_stage_id = sl.stage_id and ${scopeSql('o.id', 1)}
       order by sl.starts_at desc limit 50`,
      [scope]
    ),
```
Render before the Upcoming section (import `completeInterview` from `@/app/app/candidates/actions`, `SubmitButton`, `Badge`, `Flash`):
```tsx
      {toClose.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">To close out</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Held interviews not yet marked completed. Completing and rating moves the candidate to Interview review.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {toClose.map((u) => (
              <li key={u.slot_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
                <span>
                  <Link href={`/app/candidates/${u.id}`} className="font-medium text-primary hover:underline">{u.candidate}</Link>
                  <span className="text-muted-foreground"> · {u.title} · {u.stage} · {fmtDateTime(u.starts_at)} · {u.interviewer}</span>
                </span>
                <span className="flex items-center gap-2">
                  {u.rated ? <Badge variant="secondary">Rated</Badge> : (
                    <Link href={`/app/candidates/${u.id}#feedback`} className="text-primary underline">Add feedback</Link>
                  )}
                  <form action={completeInterview}>
                    <input type="hidden" name="applicationId" value={u.id} />
                    <input type="hidden" name="slotId" value={u.slot_id} />
                    <input type="hidden" name="back" value="/app/interviews" />
                    <SubmitButton size="sm" pendingLabel="Saving…">Mark completed</SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
```
Give the candidate page Feedback `<section>` an `id="feedback"`. Make sure the Interviews page renders a `<Flash>` (see how `app/app/openings/[id]/slots/page.tsx` does it) so `?ok=…` shows.

- [ ] **Step 5: Slots page state**

Add `sl.completed_at` to the slot query select and type. In the "Booked by" cell, after the candidate link:
```tsx
                    {s.completed_at
                      ? <Badge variant="secondary" className="ml-2">Completed</Badge>
                      : s.starts_at <= new Date() && <Badge className="ml-2 bg-amber/15 text-amber">Awaiting completion</Badge>}
```

- [ ] **Step 6: Dashboard line**

Add to the dashboard `Promise.all`:
```ts
      q<{ n: number }>(
        `select count(*)::int as n from public.slots sl
         join public.applications a on a.id = sl.application_id and a.status = 'active' and a.current_stage_id = sl.stage_id
         join public.openings o on o.id = a.opening_id
         where sl.completed_at is null and sl.starts_at <= now() and sl.starts_at > now() - interval '30 days' and ${scopeSql('o.id', 1)}`,
        [scope]
      ),
```
(Match the parameter pattern the other dashboard queries use for scope — read lines 20-110 of `app/app/page.tsx` and copy it.) Under the 24h list, inside the same `CardContent`:
```tsx
            {toCloseCount > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                <Link href="/app/interviews" className="text-primary underline">{toCloseCount} held interview{toCloseCount === 1 ? '' : 's'} to close out</Link>
              </p>
            )}
```

- [ ] **Step 7: Verify**

Seed has Devika (interview yesterday, booked) — open her candidate page: "Mark completed" appears; click → flash "Interview marked completed", badge Completed, Reopen visible. Add 3-star interview feedback → flash "Scored — moved…", stage "Interview review", `interview_review` email logged. Portal for Devika shows "is complete … reviewing". `/app/interviews` shows no more "To close out" row for her. Dashboard line count updates.

- [ ] **Step 8: Commit**

```bash
git add app/app/candidates/actions.ts "app/app/candidates/[id]/page.tsx" "app/c/[token]/page.tsx" app/app/interviews/page.tsx "app/app/openings/[id]/slots/page.tsx" app/app/page.tsx app/app/candidates/flash.ts
git commit -m "interviews: mark completed / reopen; auto-move to Interview review once rated; surfaced on portal, interviews, slots, dashboard"
```

---

### Task 5: Task tab bulk move and score column

**Files:**
- Modify: `app/app/openings/[id]/task/page.tsx` — candidate query (~75-105), table (~264-320)

**Interfaces:**
- Consumes: `bulkPipeline` (`@/app/app/candidates/actions`) with `openingId`, `back`, `intent=move`, `stageId`, `appId[]`, `notify`; `SelectAll`, `SelectedCount` (`@/components/SelectAll`); `BulkProgress` (`@/components/BulkProgress`).

- [ ] **Step 1: Query additions**

Add to the candidate query select:
```sql
            (select f.rating from public.feedback f
              where f.application_id = a.id and f.stage_id = s.id and f.rating is not null
              order by f.updated_at desc limit 1) as latest_rating,
            (select count(*)::int from public.feedback f
              where f.application_id = a.id and f.stage_id = s.id and f.rating is not null) as rating_count
```
and to the row type: `latest_rating: number | null; rating_count: number;`. Also load the opening's stages once (before the return):
```ts
  const { rows: allStages } = await q<{ id: number; name: string }>(
    `select id, name from public.stages where opening_id = $1 order by position`,
    [openingId]
  );
```

- [ ] **Step 2: Wrap the table in the bulk form**

Imports: `import { bulkPipeline } from '@/app/app/candidates/actions'; import SelectAll, { SelectedCount } from '@/components/SelectAll'; import BulkProgress from '@/components/BulkProgress'; import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';` (check `BulkProgress` export style in `components/BulkProgress.tsx`; `Flash` must already be on the page — if not, add it the way `applications/page.tsx` does, reading `ok`/`e` from `searchParams`).

Replace the `<Table>…</Table>` block inside the candidates card with:
```tsx
              <form action={bulkPipeline}>
                <input type="hidden" name="openingId" value={openingId} />
                <input type="hidden" name="back" value={`/app/openings/${openingId}/task`} />
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                      <TableHead className="w-10 px-0"><SelectAll name="appId" /></TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Now at</TableHead>
                      <TableHead>Response</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(candidatesByStage.get(t.id) ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="px-0">
                          <input type="checkbox" name="appId" value={c.id} aria-label={`Select ${c.name}`} />
                        </TableCell>
                        {/* …existing Candidate / Now at / Response / Deadline / Task cells unchanged… */}
                        <TableCell>
                          {c.latest_rating ? (
                            <>
                              <span className="text-amber">{'★'.repeat(c.latest_rating)}</span>
                              {c.rating_count > 1 && <span className="ml-1 text-xs text-muted-foreground">({c.rating_count})</span>}
                            </>
                          ) : (
                            <Link href={`/app/candidates/${c.id}#feedback`} className="text-xs text-primary underline">Score</Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(candidatesByStage.get(t.id) ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                    <BulkProgress />
                    <SelectedCount name="appId" />
                    <span className="text-muted-foreground">·</span>
                    <NativeSelect name="stageId" size="sm" className="w-44" aria-label="Stage to move to">
                      {allStages.map((s) => (
                        <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <SubmitButton name="intent" value="move" variant="outline" size="sm" pendingLabel="Moving…"
                      confirmText="Move {n} candidate(s) to {stage}?" confirmMin={2}>
                      Move to stage
                    </SubmitButton>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" name="notify" value="1" defaultChecked />
                      Email the candidate about this move
                    </label>
                  </div>
                )}
              </form>
```
Copy the five existing cells verbatim where the comment sits — the comment itself is a reminder, not something to leave in the code. Keep the exact checkbox markup `SelectAll` expects (read `components/SelectAll.tsx`: it toggles `input[name="appId"]` inside the closest form).

- [ ] **Step 3: Verify**

`/app/openings/1/task`: tick two candidates, choose "Task review", Move → confirmation dialog → redirected back to the Task tab with the "Moved 2" flash; "Now at" shows Task review. Score column shows stars for the candidate scored in Task 3.

- [ ] **Step 4: Commit**

```bash
git add "app/app/openings/[id]/task/page.tsx"
git commit -m "task tab: select candidates and move stages in bulk; latest task score column"
```

---

### Task 6: Latest feedback in the pipeline list, board and archive

**Files:**
- Modify: `lib/pipeline.ts:5-11, 22-25` (FEEDBACK_JOIN, `feedback` sort)
- Modify: `app/app/openings/[id]/applications/page.tsx` (row type ~104, select ~109, cell ~305-315, board cards ~257-265)
- Modify: `app/app/openings/[id]/applications/BoardView.tsx` (BoardCard type ~14, card render)
- Modify: `app/app/openings/[id]/archive/route.ts:49-52`
- Test: `tests/pipeline.test.ts` (existing — update if it asserts the `feedback` sort string)

- [ ] **Step 1: Join and sort**

```ts
export const PIPELINE_SORTS: Record<string, string> = {
  score: 'a.score desc nulls last, a.created_at desc',
  feedback: 'fb.rating desc nulls last, a.created_at desc',
  newest: 'a.created_at desc',
  oldest: 'a.created_at asc',
  name: 'a.name asc',
};

// newest rated feedback per application, with its stage and author
export const FEEDBACK_JOIN = `left join lateral (
  select f.rating, f.comment, s.name as stage, p.full_name as author, f.updated_at
  from public.feedback f
  left join public.stages s on s.id = f.stage_id
  join public.profiles p on p.id = f.author_id
  where f.application_id = a.id and f.rating is not null
  order by f.updated_at desc limit 1
) fb on true`;
```
Run `npm test`; if `tests/pipeline.test.ts` asserts the old sort fragment, update the expected string to `fb.rating desc nulls last, a.created_at desc`.

`grep -rn "avg_rating\|rating_count\|FEEDBACK_JOIN" app lib` — every consumer must switch to `fb.rating`, `fb.stage`, `fb.author`, `fb.comment` (the candidate page prev/next query in `app/app/candidates/[id]/page.tsx` uses `PIPELINE_SORTS` + `FEEDBACK_JOIN`; it only orders, so it keeps working).

- [ ] **Step 2: List row**

Row type: replace `avg_rating`/`rating_count` with `fb_rating: number | null; fb_stage: string | null; fb_author: string | null; fb_comment: string | null;`. Select: `fb.rating as fb_rating, fb.stage as fb_stage, fb.author as fb_author, fb.comment as fb_comment`. Cell:
```tsx
                <TableCell className="px-4 py-3">
                  {a.fb_rating != null ? (
                    <span title={`${a.fb_author}${a.fb_comment ? `: ${a.fb_comment}` : ''}`}>
                      <span className="text-amber">{'★'.repeat(a.fb_rating)}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{a.fb_stage ?? 'General'}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
```
Rename the sort option label if needed: `<NativeSelectOption value="feedback">Latest feedback</NativeSelectOption>`.

- [ ] **Step 3: Board cards**

`BoardCard` gets `rating: number | null; ratingStage: string | null;`; page passes `rating: a.fb_rating, ratingStage: a.fb_stage`. In the card markup (find where `score` is rendered in `BoardView.tsx`) add:
```tsx
              {card.rating != null && (
                <span className="text-xs" title={card.ratingStage ?? undefined}>
                  <span className="text-amber">{'★'.repeat(card.rating)}</span>
                </span>
              )}
```

- [ ] **Step 4: Archive**

```ts
      q(
        `select f.application_id, p.full_name as author, s.name as stage, f.rating, f.comment, f.created_at
         from public.feedback f join public.profiles p on p.id = f.author_id
         left join public.stages s on s.id = f.stage_id
         where f.application_id = any($1)`,
        [appIds]
      ),
```
Check how the archive writes feedback rows (CSV/JSON) further down and include `stage` in the header/row if it enumerates columns explicitly.

- [ ] **Step 5: Verify and commit**

`/app/openings/1/applications`: Feedback column shows "★★★★ Task" for the scored candidate; sort by "Latest feedback" puts them first; board view card shows stars. `npm test` → `# fail 0`; `npx tsc --noEmit` clean for app code.

```bash
git add lib/pipeline.ts tests/pipeline.test.ts "app/app/openings/[id]/applications/page.tsx" "app/app/openings/[id]/applications/BoardView.tsx" "app/app/openings/[id]/archive/route.ts"
git commit -m "pipeline: show the latest feedback with its stage; board stars; archive feedback carries stage"
```

---

### Task 7: End-to-end check and handover

**Files:** none new; `docs/ux-audit-2026-09-07.md` is not touched.

- [ ] **Step 1: Full local run**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"      # expect nothing
npm test 2>&1 | grep -E "^# (pass|fail)"        # expect fail 0
node scripts/seed-dev.mjs | tail -3             # fresh data
```
Then walk, in Chrome on `http://localhost:3002` as dev-admin:
1. Stages page of opening 1: seven stages with the two review kinds; add a stage → the kind select offers `task_review`/`interview_review`.
2. Task-stage candidate: score → auto-move + email; Task tab: score column, bulk move two others to Task review.
3. Interview candidate with a past slot: Mark completed → rate → auto-move + email; Reopen works on another; portal text.
4. Pipeline: latest feedback column and sort; board stars.
5. Interviews page: To close out list; dashboard line.
6. Settings: `task_review` and `interview_review` templates listed and editable.
7. Log in as `sara@example.com` (interviewer): candidate page for someone outside her openings → forbidden; her own interviewee → can complete and rate.

- [ ] **Step 2: Report to the owner**

List what was built, the URLs/logins above, and that production needs `npx supabase db push` (migration `20260909090000_review_stages.sql`) at ship time — the backfill adds two stages to every opening and renumbers positions. Ship nothing until approved.

'use server';

import path from 'node:path';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { q, tx } from '@/lib/db';
import { forbidden, requireApplicationAccess, requireOpeningAccess, verifyUploadPath } from '@/lib/auth';
import { appUrl, attemptSend, portalUrl, sendCustomEmail, sendEmail } from '@/lib/email';
import { fmtDateTimeFull, fmtDay, orgTimeToUtc } from '@/lib/tz';
const fmtWhen = fmtDateTimeFull;
import { audit } from '@/lib/audit';
import { composeBriefEmail } from '@/lib/brief';
import { BOOKED_SLOT_COLS, freeFutureSlots, notifyBooking, type BookedSlot } from '@/lib/slots';
import { RESUME_EXTS, RESUME_MAX_BYTES, saveUpload } from '@/lib/storage';
import { uploadedPathRe } from '@/lib/uploads';
import { nextReviewStage } from '@/lib/advance';

/** Only paths starting with /app/ may be used as a post-action redirect target. */
function safeBack(raw: unknown, fallback: string): string {
  const s = String(raw ?? '');
  return /^\/app\/[^\s]*$/.test(s) && !s.startsWith('//') ? s : fallback;
}

function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, 'http://x');
  u.searchParams.set(key, value);
  return u.pathname + u.search;
}

/**
 * Email candidates about a stage move. Task and interview stages always send
 * (the mail carries instructions); the generic "moved forward" update is only
 * sent when the move is actually forward — backwards/sideways moves are silent.
 */
async function notifyStage(moved: { id: number; from_stage_id: number | null }[], stageId: number) {
  const {
    rows: [stage],
  } = await q<{ name: string; kind: string; brief: string; brief_file_path: string; brief_links: string; task_days: number; title: string; position: number }>(
    `select s.name, s.kind, s.brief, s.brief_file_path, s.brief_links, s.task_days, s.position, o.title
     from public.stages s join public.openings o on o.id = s.opening_id
     where s.id = $1`,
    [stageId]
  );
  if (!stage) return;
  const KIND_TEMPLATE: Record<string, string> = {
    interview: 'interview_invite',
    task: 'task_assigned',
    task_review: 'task_review',
    interview_review: 'interview_review',
  };
  const template = KIND_TEMPLATE[stage.kind] ?? 'stage_update';

  const { rows: positions } = await q<{ id: number; position: number }>(
    `select id, position from public.stages where id = any($1)`,
    [moved.map((m) => m.from_stage_id).filter((x): x is number => x != null)]
  );
  const posOf = new Map(positions.map((p) => [Number(p.id), p.position]));
  const ids = moved
    .filter((m) => {
      if (template !== 'stage_update') return true;
      const from = m.from_stage_id != null ? posOf.get(Number(m.from_stage_id)) : undefined;
      return from == null || stage.position > from;
    })
    .map((m) => m.id);
  if (ids.length === 0) return;

  const { rows: apps } = await q<{ id: number; name: string; email: string; portal_token: string }>(
    `select id, name, email, portal_token from public.applications where id = any($1)`,
    [ids]
  );
  for (const a of apps) {
    await sendEmail({
      applicationId: a.id,
      template,
      to: a.email,
      vars: {
        name: a.name,
        role: stage.title,
        stage: stage.name,
        brief:
          stage.kind === 'task'
            ? composeBriefEmail(
                stage.brief,
                stage.brief_links,
                stage.brief_file_path ? `${portalUrl(a.portal_token)}/brief` : '',
                stage.task_days > 0 ? fmtDay(new Date(Date.now() + stage.task_days * 86_400_000)) : ''
              )
            : stage.brief || 'Task details will follow.',
        portal_link: portalUrl(a.portal_token),
      },
    });
  }
}

/** Move candidates; returns how many actually changed stage. */
async function moveApplications(
  userId: string,
  openingId: number,
  ids: number[],
  stageId: number,
  email: boolean
): Promise<number> {
  const moved = await tx(async (c) => {
    const { rows } = await c.query<{ id: number; from_stage_id: number | null }>(
      `update public.applications a set current_stage_id = $2
       from public.applications old
       where old.id = a.id and a.id = any($1) and a.opening_id = $3
         and a.status = 'active'
         and old.current_stage_id is distinct from $2
       returning a.id, old.current_stage_id as from_stage_id`,
      [ids, stageId, openingId]
    );
    if (rows.length > 0) {
      await c.query(
        `insert into public.stage_history (application_id, from_stage_id, to_stage_id, changed_by)
         select unnest($1::bigint[]), unnest($2::bigint[]), $3, $4`,
        [rows.map((m) => m.id), rows.map((m) => m.from_stage_id), stageId, userId]
      );
    }
    return rows.map((m) => ({ id: Number(m.id), from_stage_id: m.from_stage_id }));
  });
  if (moved.length > 0) {
    const movedIds = moved.map((m) => m.id);
    await freeFutureSlots(movedIds, stageId, { notifyCandidate: email });
    if (email) await notifyStage(moved, stageId);
    await audit(userId, 'move_stage', 'application', movedIds.join(','), { stageId, email });
  }
  return moved.length;
}

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

/** Single-candidate move for the board view's drag-drop (always emails; the board confirms first). */
export async function moveOne(openingId: number, applicationId: number, stageId: number) {
  const user = await requireOpeningAccess(openingId);
  await moveApplications(user.id, openingId, [applicationId], stageId, true);
  revalidatePath(`/app/openings/${openingId}/applications`);
  revalidatePath(`/app/candidates/${applicationId}`);
}

/**
 * Bulk pipeline action from the applications table and the candidate page
 * (move / reject / restore / hire / withdraw). Redirects back to `back` with
 * `?ok=<intent>:<n>` or `?e=nothing` so the page can report what happened.
 */
export async function bulkPipeline(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  const ids = formData.getAll('appId').map(Number).filter(Boolean);
  const intent = String(formData.get('intent'));
  const back = safeBack(formData.get('back'), `/app/openings/${openingId}/applications`);
  if (ids.length === 0) redirect(withParam(back, 'e', 'nothing'));

  let n = 0;
  if (intent === 'move') {
    const stageId = Number(formData.get('stageId'));
    if (!stageId) redirect(withParam(back, 'e', 'nothing'));
    n = await moveApplications(user.id, openingId, ids, stageId, formData.get('notify') != null);
  } else if (intent === 'reject_send' || intent === 'reject_draft') {
    const { rows: apps } = await q<{ id: number; name: string; email: string; title: string }>(
      `update public.applications a set status = 'rejected'
       from public.openings o
       where a.id = any($1) and a.opening_id = $2 and o.id = a.opening_id and a.status = 'active'
       returning a.id, a.name, a.email, o.title`,
      [ids, openingId]
    );
    await freeFutureSlots(apps.map((a) => a.id), null);
    for (const a of apps) {
      await sendEmail({
        applicationId: a.id,
        template: 'rejection',
        to: a.email,
        vars: { name: a.name, role: a.title },
        // drafts sit in the Emails tab until staff send them manually
        draft: intent === 'reject_draft',
      });
    }
    n = apps.length;
    await audit(user.id, 'reject', 'application', ids.join(','));
  } else if (intent === 'withdraw') {
    // staff records a withdrawal the candidate made by phone/mail — no email
    const { rowCount } = await q(
      `update public.applications set status = 'withdrawn'
       where id = any($1) and opening_id = $2 and status = 'active'`,
      [ids, openingId]
    );
    await freeFutureSlots(ids, null);
    n = rowCount ?? 0;
    await audit(user.id, 'withdraw', 'application', ids.join(','));
  } else if (intent === 'restore') {
    const { rowCount } = await q(
      `update public.applications set status = 'active' where id = any($1) and opening_id = $2 and status <> 'active'`,
      [ids, openingId]
    );
    // cancel rejection emails not yet delivered (drafts or queued retries); undo a no-show mark
    await q(
      `update public.email_log set status = 'cancelled'
       where application_id = any($1) and template in ('rejection', 'no_show') and status in ('draft', 'pending', 'failed')`,
      [ids]
    );
    await q(`update public.slots set no_show_at = null where application_id = any($1) and no_show_at is not null`, [ids]);
    n = rowCount ?? 0;
    await audit(user.id, 'restore', 'application', ids.join(','));
  } else if (intent === 'hire') {
    const { rows: hired } = await q<{ id: number; name: string; email: string; title: string }>(
      `update public.applications a set status = 'hired'
       from public.openings o
       where a.id = any($1) and a.opening_id = $2 and o.id = a.opening_id and a.status = 'active'
       returning a.id, a.name, a.email, o.title`,
      [ids, openingId]
    );
    for (const a of hired) {
      await sendEmail({
        applicationId: a.id,
        template: 'hired',
        to: a.email,
        vars: { name: a.name, role: a.title },
      });
    }
    n = hired.length;
    await audit(user.id, 'hire', 'application', ids.join(','));
  } else {
    redirect(withParam(back, 'e', 'nothing'));
  }
  redirect(n === 0 ? withParam(back, 'e', 'nothing') : withParam(back, 'ok', `${intent}:${n}`));
}

/** Staff edits a candidate's contact details (typos from walk-in entry). */
export async function updateCandidate(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const name = String(formData.get('name') ?? '').trim().slice(0, 200);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const phone = String(formData.get('phone') ?? '').trim().slice(0, 50);
  const back = `/app/candidates/${applicationId}`;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`${back}?e=invalid`);
  try {
    await q(`update public.applications set name = $2, email = $3, phone = $4 where id = $1`, [
      applicationId,
      name,
      email,
      phone,
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') redirect(`${back}?e=duplicate`);
    throw e;
  }
  await audit(user.id, 'update_candidate', 'application', applicationId);
  redirect(`${back}?ok=saved`);
}

/** Staff manually adds a candidate (walk-in / WhatsApp resume). */
export async function addCandidate(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  const name = String(formData.get('name') ?? '').trim().slice(0, 200);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const phone = String(formData.get('phone') ?? '').trim().slice(0, 50);
  const stageId = Number(formData.get('stageId')) || null;
  const note = String(formData.get('note') ?? '').trim().slice(0, 2000);
  const resume = formData.get('resume');
  const back = `/app/openings/${openingId}/applications/new`;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`${back}?e=invalid`);

  let resumePath = '';
  const preUploaded = String(formData.get('resumePath') ?? '');
  if (preUploaded) {
    // browser uploaded straight to storage (Vercel body cap); the path must be
    // one our upload-url route minted, proven by its signature
    const sig = String(formData.get('resumeSig') ?? '');
    if (!uploadedPathRe('resumes').test(preUploaded) || !sig || !verifyUploadPath(0, preUploaded, sig)) {
      redirect(`${back}?e=resume`);
    }
    resumePath = preUploaded;
  } else if (resume instanceof File && resume.size > 0) {
    if (resume.size > RESUME_MAX_BYTES || !RESUME_EXTS.has(path.extname(resume.name).toLowerCase())) {
      redirect(`${back}?e=resume`);
    }
    resumePath = await saveUpload('resumes', resume);
  }

  const {
    rows: [form],
  } = await q<{ id: number }>(
    `select id from public.forms where opening_id = $1
     order by is_published desc, version desc limit 1`,
    [openingId]
  );
  if (!form) redirect(back);

  let appId: number;
  try {
    appId = await tx(async (c) => {
      const {
        rows: [app],
      } = await c.query(
        `insert into public.applications
           (opening_id, form_id, name, email, phone, resume_path, utm, current_stage_id)
         values ($1, $2, $3, $4, $5, $6, '{"utm_source":"manual"}', $7)
         returning id`,
        [openingId, form.id, name, email, phone, resumePath, stageId]
      );
      if (stageId) {
        await c.query(
          `insert into public.stage_history (application_id, to_stage_id, changed_by) values ($1, $2, $3)`,
          [app.id, stageId, user.id]
        );
      }
      if (note) {
        await c.query(
          `insert into public.notes (application_id, author_id, body) values ($1, $2, $3)`,
          [app.id, user.id, note]
        );
      }
      return app.id as number;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') redirect(`${back}?e=duplicate`);
    throw e;
  }
  await audit(user.id, 'add_candidate', 'application', appId);
  redirect(`/app/candidates/${appId}?ok=added`);
}

/** Bulk import from the old Excel workflow (CSV: name,email,phone,status,notes). */
export async function importCsv(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  const file = formData.get('file');
  const back = `/app/openings/${openingId}/applications/new`;
  if (!(file instanceof File) || file.size === 0 || file.size > 2 * 1024 * 1024) {
    redirect(`${back}?e=csv`);
  }
  const { parseCsv } = await import('@/lib/csv');
  const rows = parseCsv(await (file as File).text());
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();
  if (!header.includes('name') || !header.includes('email')) redirect(`${back}?e=csv`);

  const {
    rows: [form],
  } = await q<{ id: number }>(
    `select id from public.forms where opening_id = $1 order by is_published desc, version desc limit 1`,
    [openingId]
  );
  const VALID = new Set(['active', 'hired', 'rejected', 'withdrawn']);
  let imported = 0;
  let skipped = 0;
  for (const r of rows.slice(0, 1000)) {
    const name = col(r, 'name').slice(0, 200);
    const email = col(r, 'email').toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      skipped++;
      continue;
    }
    const status = VALID.has(col(r, 'status')) ? col(r, 'status') : 'active';
    try {
      const {
        rows: [app],
      } = await q<{ id: number }>(
        `insert into public.applications (opening_id, form_id, name, email, phone, status, utm)
         values ($1, $2, $3, $4, $5, $6, '{"utm_source":"import"}') returning id`,
        [openingId, form.id, name, email, col(r, 'phone').slice(0, 50), status]
      );
      const note = col(r, 'notes').slice(0, 2000);
      if (note) {
        await q(`insert into public.notes (application_id, author_id, body) values ($1, $2, $3)`, [
          app.id,
          user.id,
          `[imported] ${note}`,
        ]);
      }
      imported++;
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e; // duplicates skipped
      skipped++;
    }
  }
  await audit(user.id, 'import_csv', 'opening', openingId, { imported, skipped });
  redirect(`/app/openings/${openingId}/applications?imported=${imported}&skipped=${skipped}`);
}

/** One-off email from a candidate profile. */
export async function composeEmail(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const subject = String(formData.get('subject') ?? '').trim().slice(0, 300);
  const body = String(formData.get('body') ?? '').trim().slice(0, 10_000);
  if (!subject || !body) return;
  const {
    rows: [app],
  } = await q<{ email: string }>(`select email from public.applications where id = $1`, [applicationId]);
  if (!app) return;
  await sendCustomEmail(applicationId, app.email, subject, body);
  await audit(user.id, 'email_candidate', 'application', applicationId, { subject });
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Send an already-logged email again, as a new outbox row, to the candidate's current address. */
export async function resendEmail(formData: FormData) {
  const emailId = Number(formData.get('emailId'));
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const {
    rows: [row],
  } = await q<{ id: number }>(
    `insert into public.email_log (application_id, template, to_email, subject, body, ics, status)
     select e.application_id, e.template, a.email, e.subject, e.body, e.ics, 'pending'
     from public.email_log e join public.applications a on a.id = e.application_id
     where e.id = $1 and e.application_id = $2 and e.status in ('sent', 'failed')
     returning id`,
    [emailId, applicationId]
  );
  if (!row) return;
  await attemptSend(row.id);
  await audit(user.id, 'resend_email', 'application', applicationId, { emailId, newEmailId: row.id });
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Staff books an open slot for a candidate (phone bookings). */
export async function staffBookSlot(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const slotId = Number(formData.get('slotId'));
  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; portal_token: string; stage_id: number | null; title: string }>(
    `select a.id, a.name, a.email, a.portal_token, a.current_stage_id as stage_id, o.title
     from public.applications a join public.openings o on o.id = a.opening_id
     where a.id = $1 and a.status = 'active'`,
    [applicationId]
  );
  if (!a || !a.stage_id || !slotId) return;
  const {
    rows: [slot],
  } = await q<BookedSlot>(
    `update public.slots sl set application_id = $1
     from public.profiles p
     where sl.id = $2 and sl.stage_id = $3 and sl.application_id is null
       and sl.starts_at > now() and p.id = sl.interviewer_id
     returning ${BOOKED_SLOT_COLS}`,
    [a.id, slotId, a.stage_id]
  );
  if (!slot) redirect(`/app/candidates/${applicationId}?e=taken`);
  await notifyBooking(a, slot);
  await audit(user.id, 'book_slot', 'application', applicationId, { slotId });
  redirect(`/app/candidates/${applicationId}?ok=booked`);
}

/** Staff cancels one of a candidate's future bookings; interviewer and candidate are emailed. */
export async function staffCancelSlot(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const slotId = Number(formData.get('slotId')) || null;
  const n = await freeFutureSlots([applicationId], null, { slotId, notifyCandidate: true });
  await audit(user.id, 'cancel_slot', 'application', applicationId, { slotId });
  redirect(`/app/candidates/${applicationId}?${n ? 'ok=cancelled' : 'e=nothing'}`);
}

/** Staff marks a held interview as completed with its rating: saves the feedback, hides slot picking for the candidate, and auto-advances to Interview review. Called from CompleteInterviewButton. */
export async function completeInterview(
  formData: FormData
): Promise<{ ok?: 'auto_review' | 'interview_done'; error?: 'rating_required' | 'nothing' }> {
  const applicationId = Number(formData.get('applicationId'));
  const slotId = Number(formData.get('slotId'));
  const { user } = await requireApplicationAccess(applicationId);
  // completing an interview is the act of rating it: stars required, note optional
  const rating = Number(formData.get('rating')) || 0;
  const comment = String(formData.get('comment') ?? '').trim();
  if (rating < 1 || rating > 5) return { error: 'rating_required' };
  const {
    rows: [slot],
  } = await q<{ stage_id: number }>(
    `update public.slots set completed_at = now()
     where id = $1 and application_id = $2 and starts_at <= now() and completed_at is null
     returning stage_id`,
    [slotId, applicationId]
  );
  if (!slot) return { error: 'nothing' };
  await q(
    `insert into public.feedback (application_id, stage_id, author_id, rating, comment)
     values ($1, $2, $3, $4, $5)
     on conflict (application_id, stage_id, author_id)
     do update set rating = excluded.rating, comment = excluded.comment, updated_at = now()`,
    [applicationId, slot.stage_id, user.id, rating, comment]
  );
  await audit(user.id, 'interview_completed', 'application', applicationId, { slotId, rating });
  const moved = await maybeAutoAdvance(user.id, applicationId, Number(slot.stage_id));
  // Returns instead of redirecting: the dialog that calls this closes itself and
  // refreshes, which keeps the response small and never leaves the button pending.
  return { ok: moved ? 'auto_review' : 'interview_done' };
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

/** Add / remove a tag on a candidate. */
export async function updateTags(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const add = String(formData.get('add') ?? '').trim().toLowerCase().slice(0, 40);
  const remove = String(formData.get('remove') ?? '').trim();
  if (!add && !remove) return;
  if (add) {
    await q(
      `update public.applications set tags = array(select distinct unnest(tags || $2::text))
       where id = $1`,
      [applicationId, add]
    );
  } else if (remove) {
    await q(`update public.applications set tags = array_remove(tags, $2) where id = $1`, [
      applicationId,
      remove,
    ]);
  }
  await audit(user.id, 'tags', 'application', applicationId, { add, remove });
  revalidatePath(`/app/candidates/${applicationId}`);
}

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

export async function addNote(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;
  await q(`insert into public.notes (application_id, author_id, body) values ($1, $2, $3)`, [
    applicationId,
    user.id,
    body,
  ]);
  await audit(user.id, 'note', 'application', applicationId);
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Candidate booked but never turned up: mark the slot, reject them with the no-show email. */
export async function markNoShow(formData: FormData) {
  const applicationId = Number(formData.get('applicationId'));
  const slotId = Number(formData.get('slotId'));
  const { user } = await requireApplicationAccess(applicationId);
  const back = safeBack(formData.get('back'), `/app/candidates/${applicationId}`);
  const {
    rows: [slot],
  } = await q<{ starts_at: Date }>(
    `update public.slots sl set no_show_at = now()
     where sl.id = $1 and sl.application_id = $2 and sl.starts_at <= now()
       and sl.completed_at is null and sl.no_show_at is null
       and not exists (select 1 from public.reschedule_requests r where r.slot_id = sl.id and r.status = 'pending')
     returning sl.starts_at`,
    [slotId, applicationId]
  );
  if (!slot) redirect(withParam(back, 'e', 'nothing'));
  const {
    rows: [a],
  } = await q<{ name: string; email: string; title: string }>(
    `update public.applications a set status = 'rejected'
     from public.openings o where a.id = $1 and o.id = a.opening_id and a.status = 'active'
     returning a.name, a.email, o.title`,
    [applicationId]
  );
  await freeFutureSlots([applicationId], null);
  if (a) {
    await sendEmail({
      applicationId,
      template: 'no_show',
      to: a.email,
      vars: { name: a.name, role: a.title, when: fmtWhen(slot.starts_at) },
    });
  }
  await audit(user.id, 'no_show', 'application', applicationId, { slotId });
  redirect(withParam(back, 'ok', 'no_show'));
}

type DecisionResult = { ok?: 'reschedule_approved' | 'reschedule_rejected'; error?: 'nothing' | 'time' | 'link' | 'interviewer' };

/**
 * Approve a reschedule request: create a slot at the chosen time, book the candidate
 * into it, release whatever they held in that stage, email everyone. Returns for the
 * dialog that called it (see RescheduleDecision).
 */
export async function approveReschedule(formData: FormData): Promise<DecisionResult> {
  const requestId = Number(formData.get('requestId'));
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const date = String(formData.get('date') ?? '');
  const time = String(formData.get('time') ?? '');
  const interviewerId = String(formData.get('interviewerId') ?? '');
  const duration = Math.max(5, Number(formData.get('duration')) || 30);
  const meetingLink = String(formData.get('meetingLink') ?? '').trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { error: 'time' };
  const startsAt = orgTimeToUtc(date, time);
  if (!(startsAt.getTime() > Date.now())) return { error: 'time' };
  if (!meetingLink) return { error: 'link' };
  if (!interviewerId) return { error: 'interviewer' };

  const result = await tx(async (c) => {
    const {
      rows: [r],
    } = await c.query<{ stage_id: number; opening_id: number; panel: string[] | null; old_starts: Date | null; old_interviewer_email: string | null }>(
      `update public.reschedule_requests r set status = 'approved', decided_by = $3, decided_at = now()
       from public.stages s
       where r.id = $1 and r.application_id = $2 and r.status = 'pending' and s.id = r.stage_id
       returning r.stage_id, s.opening_id,
         (select sl.panel from public.slots sl where sl.id = r.slot_id) as panel,
         (select sl.starts_at from public.slots sl where sl.id = r.slot_id) as old_starts,
         (select u.email from public.slots sl join auth.users u on u.id = sl.interviewer_id where sl.id = r.slot_id) as old_interviewer_email`,
      [requestId, applicationId, user.id]
    );
    if (!r) return null;
    // release what the candidate holds in this stage (even if past) so the one-booking rule admits the new slot
    await c.query(`update public.slots set application_id = null where application_id = $1 and stage_id = $2`, [applicationId, r.stage_id]);
    const panel = (r.panel ?? []).filter((id) => id !== interviewerId);
    const {
      rows: [slot],
    } = await c.query<BookedSlot & { id: number }>(
      `insert into public.slots (opening_id, stage_id, interviewer_id, starts_at, duration_mins, meeting_link, panel, application_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, starts_at, duration_mins, meeting_link, panel,
         (select full_name from public.profiles where id = $3) as interviewer,
         (select email from auth.users where id = $3) as interviewer_email`,
      [r.opening_id, r.stage_id, interviewerId, startsAt.toISOString(), duration, meetingLink, panel, applicationId]
    );
    return { ...r, slot };
  });
  if (!result) return { error: 'nothing' };

  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; portal_token: string; title: string }>(
    `select a.id, a.name, a.email, a.portal_token, o.title
     from public.applications a join public.openings o on o.id = a.opening_id where a.id = $1`,
    [applicationId]
  );
  if (result.old_interviewer_email && result.old_starts && result.old_starts > new Date()) {
    await sendEmail({
      applicationId,
      template: 'interviewer_cancelled',
      to: result.old_interviewer_email,
      vars: { name: a.name, role: a.title, when: fmtWhen(result.old_starts) },
    });
  }
  await notifyBooking(a, result.slot, 'reschedule_approved');
  await audit(user.id, 'reschedule_approved', 'application', applicationId, { requestId, slotId: result.slot.id });
  return { ok: 'reschedule_approved' };
}

/** Decline a reschedule request: the original booking stands; the candidate is told why. */
export async function rejectReschedule(formData: FormData): Promise<DecisionResult> {
  const requestId = Number(formData.get('requestId'));
  const applicationId = Number(formData.get('applicationId'));
  const { user } = await requireApplicationAccess(applicationId);
  const note = String(formData.get('note') ?? '').trim().slice(0, 500);
  const {
    rows: [r],
  } = await q<{ requested_at: Date; when_at: Date | null }>(
    `update public.reschedule_requests r set status = 'rejected', decided_by = $3, decided_at = now(), decision_note = $4
     where r.id = $1 and r.application_id = $2 and r.status = 'pending'
     returning r.requested_at, (select sl.starts_at from public.slots sl where sl.id = r.slot_id) as when_at`,
    [requestId, applicationId, user.id, note]
  );
  if (!r) return { error: 'nothing' };
  const {
    rows: [a],
  } = await q<{ name: string; email: string; portal_token: string; title: string }>(
    `select a.name, a.email, a.portal_token, o.title
     from public.applications a join public.openings o on o.id = a.opening_id where a.id = $1`,
    [applicationId]
  );
  await sendEmail({
    applicationId,
    template: 'reschedule_rejected',
    to: a.email,
    vars: {
      name: a.name,
      role: a.title,
      when: r.when_at ? fmtWhen(r.when_at) : 'the original time',
      requested: fmtWhen(r.requested_at),
      reason: note,
      portal_link: portalUrl(a.portal_token),
    },
  });
  await audit(user.id, 'reschedule_rejected', 'application', applicationId, { requestId });
  return { ok: 'reschedule_rejected' };
}

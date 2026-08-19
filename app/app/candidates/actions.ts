'use server';

import path from 'node:path';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { q, tx } from '@/lib/db';
import { currentUser, isStaff } from '@/lib/auth';
import { appUrl, icsEvent, portalUrl, sendCustomEmail, sendEmail } from '@/lib/email';
import { fmtDateTimeFull } from '@/lib/tz';
import { audit } from '@/lib/audit';
import { freeFutureSlots, staffEmails } from '@/lib/slots';
import { RESUME_EXTS, RESUME_MAX_BYTES, saveUpload } from '@/lib/storage';

const REJECTION_DELAY_MINUTES = 30; // undo window: restore cancels the pending email

async function requireStaff() {
  const user = await currentUser();
  if (!isStaff(user)) throw new Error('Not allowed');
  return user;
}

async function notifyStage(applicationIds: number[], stageId: number) {
  const {
    rows: [stage],
  } = await q<{ name: string; kind: string; brief: string; title: string }>(
    `select s.name, s.kind, s.brief, o.title
     from public.stages s join public.openings o on o.id = s.opening_id
     where s.id = $1`,
    [stageId]
  );
  if (!stage) return;
  // every stage move emails the candidate: task/interview get their specific
  // instructions, everything else (shortlist, offer, …) a progress update
  const template =
    stage.kind === 'interview'
      ? 'interview_invite'
      : stage.kind === 'task'
        ? 'task_assigned'
        : 'stage_update';

  const { rows: apps } = await q<{ id: number; name: string; email: string; portal_token: string }>(
    `select id, name, email, portal_token from public.applications where id = any($1)`,
    [applicationIds]
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
        brief: stage.brief || 'Task details will follow.',
        portal_link: portalUrl(a.portal_token),
      },
    });
  }
}

const freeSlots = freeFutureSlots;

async function moveApplications(userId: string, openingId: number, ids: number[], stageId: number) {
  const moved = await tx(async (c) => {
    const { rows } = await c.query(
      `update public.applications a set current_stage_id = $2
       from public.applications old
       where old.id = a.id and a.id = any($1) and a.opening_id = $3
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
    return rows.map((m) => m.id as number);
  });
  if (moved.length > 0) {
    await freeSlots(moved, stageId);
    await notifyStage(moved, stageId);
    await audit(userId, 'move_stage', 'application', moved.join(','), { stageId });
  }
}

/** Single-candidate move for the board view's drag-drop. */
export async function moveOne(openingId: number, applicationId: number, stageId: number) {
  const user = await requireStaff();
  await moveApplications(user.id, openingId, [applicationId], stageId);
  revalidatePath(`/app/openings/${openingId}/applications`);
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Bulk pipeline action from the applications table (move / reject / restore / hire). */
export async function bulkPipeline(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const ids = formData.getAll('appId').map(Number).filter(Boolean);
  const intent = String(formData.get('intent'));
  if (ids.length === 0) return;

  if (intent === 'move') {
    const stageId = Number(formData.get('stageId'));
    if (!stageId) return;
    await moveApplications(user.id, openingId, ids, stageId);
  } else if (intent === 'reject') {
    const { rows: apps } = await q<{ id: number; name: string; email: string; title: string }>(
      `update public.applications a set status = 'rejected'
       from public.openings o
       where a.id = any($1) and a.opening_id = $2 and o.id = a.opening_id and a.status = 'active'
       returning a.id, a.name, a.email, o.title`,
      [ids, openingId]
    );
    await freeSlots(apps.map((a) => a.id), null);
    if (formData.get('sendRejectEmail')) {
      for (const a of apps) {
        await sendEmail({
          applicationId: a.id,
          template: 'rejection',
          to: a.email,
          vars: { name: a.name, role: a.title },
          delayMinutes: REJECTION_DELAY_MINUTES,
        });
      }
    }
    await audit(user.id, 'reject', 'application', ids.join(','));
  } else if (intent === 'restore') {
    await q(
      `update public.applications set status = 'active' where id = any($1) and opening_id = $2`,
      [ids, openingId]
    );
    // undo window: cancel rejection emails still waiting in the outbox
    await q(
      `update public.email_log set status = 'cancelled'
       where application_id = any($1) and template = 'rejection' and status = 'pending'`,
      [ids]
    );
    await audit(user.id, 'restore', 'application', ids.join(','));
  } else if (intent === 'hire') {
    await q(
      `update public.applications set status = 'hired'
       where id = any($1) and opening_id = $2 and status = 'active'`,
      [ids, openingId]
    );
    await audit(user.id, 'hire', 'application', ids.join(','));
  }
  revalidatePath(`/app/openings/${openingId}/applications`);
  for (const id of ids) revalidatePath(`/app/candidates/${id}`);
}

/** Staff manually adds a candidate (walk-in / WhatsApp resume). */
export async function addCandidate(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const name = String(formData.get('name') ?? '').trim().slice(0, 200);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const phone = String(formData.get('phone') ?? '').trim().slice(0, 50);
  const stageId = Number(formData.get('stageId')) || null;
  const note = String(formData.get('note') ?? '').trim().slice(0, 2000);
  const resume = formData.get('resume');
  const back = `/app/openings/${openingId}/applications/new`;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`${back}?e=invalid`);

  let resumePath = '';
  if (resume instanceof File && resume.size > 0) {
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
  redirect(`/app/candidates/${appId}`);
}

/** Bulk import from the old Excel workflow (CSV: name,email,phone,status,notes). */
export async function importCsv(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
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
  for (const r of rows.slice(0, 1000)) {
    const name = col(r, 'name').slice(0, 200);
    const email = col(r, 'email').toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
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
    }
  }
  await audit(user.id, 'import_csv', 'opening', openingId, { imported });
  redirect(`/app/openings/${openingId}/applications`);
}

/** One-off email from a candidate profile. */
export async function composeEmail(formData: FormData) {
  await requireStaff();
  const applicationId = Number(formData.get('applicationId'));
  const subject = String(formData.get('subject') ?? '').trim().slice(0, 300);
  const body = String(formData.get('body') ?? '').trim().slice(0, 10_000);
  if (!subject || !body) return;
  const {
    rows: [app],
  } = await q<{ email: string }>(`select email from public.applications where id = $1`, [applicationId]);
  if (!app) return;
  await sendCustomEmail(applicationId, app.email, subject, body);
  const user = await currentUser();
  await audit(user.id, 'email_candidate', 'application', applicationId, { subject });
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Staff books an open slot for a candidate (phone bookings). */
export async function staffBookSlot(formData: FormData) {
  const user = await requireStaff();
  const applicationId = Number(formData.get('applicationId'));
  const slotId = Number(formData.get('slotId'));
  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; stage_id: number | null; title: string }>(
    `select a.id, a.name, a.email, a.current_stage_id as stage_id, o.title
     from public.applications a join public.openings o on o.id = a.opening_id
     where a.id = $1 and a.status = 'active'`,
    [applicationId]
  );
  if (!a || !a.stage_id || !slotId) return;
  const {
    rows: [slot],
  } = await q<{ starts_at: Date; duration_mins: number; interviewer: string; meeting_link: string; interviewer_email: string | null; panel: string[] }>(
    `update public.slots sl set application_id = $1
     from public.profiles p
     where sl.id = $2 and sl.stage_id = $3 and sl.application_id is null
       and sl.starts_at > now() and p.id = sl.interviewer_id
     returning sl.starts_at, sl.duration_mins, p.full_name as interviewer, sl.meeting_link,
       (select u.email from auth.users u where u.id = p.id) as interviewer_email, sl.panel`,
    [a.id, slotId, a.stage_id]
  );
  if (!slot) return;
  const when = fmtDateTimeFull(slot.starts_at);
  const ics = icsEvent({
    title: `Interview — ${a.title}`,
    startsAt: slot.starts_at,
    durationMins: slot.duration_mins,
    description: `Interview with ${slot.interviewer}`,
  });
  await sendEmail({
    applicationId: a.id,
    template: 'booking_confirmation',
    to: a.email,
    vars: {
      name: a.name, role: a.title, when,
      duration: String(slot.duration_mins), interviewer: slot.interviewer, link: slot.meeting_link,
    },
    ics,
  });
  const panelEmails = await staffEmails(slot.panel ?? []);
  for (const to of [slot.interviewer_email, ...panelEmails].filter(Boolean) as string[]) {
    await sendEmail({
      applicationId: a.id,
      template: 'interviewer_booked',
      to,
      vars: {
        name: a.name, role: a.title, when,
        duration: String(slot.duration_mins), profile_link: appUrl(`/app/candidates/${a.id}`),
      },
      ics,
    });
  }
  await audit(user.id, 'book_slot', 'application', applicationId, { slotId });
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Staff cancels a candidate's future booking. */
export async function staffCancelSlot(formData: FormData) {
  const user = await requireStaff();
  const applicationId = Number(formData.get('applicationId'));
  await freeSlots([applicationId], null);
  await audit(user.id, 'cancel_slot', 'application', applicationId);
  revalidatePath(`/app/candidates/${applicationId}`);
}

/** Add / remove a tag on a candidate. */
export async function updateTags(formData: FormData) {
  await requireStaff();
  const applicationId = Number(formData.get('applicationId'));
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
  const user = await currentUser();
  await audit(user.id, 'tags', 'application', applicationId, { add, remove });
  revalidatePath(`/app/candidates/${applicationId}`);
}

export async function addFeedback(formData: FormData) {
  const user = await currentUser();
  const applicationId = Number(formData.get('applicationId'));
  const rating = Number(formData.get('rating')) || null;
  const comment = String(formData.get('comment') ?? '').trim();
  const {
    rows: [app],
  } = await q<{ current_stage_id: number | null }>(
    `select current_stage_id from public.applications where id = $1`,
    [applicationId]
  );
  await q(
    `insert into public.feedback (application_id, stage_id, author_id, rating, comment)
     values ($1, $2, $3, $4, $5)
     on conflict (application_id, stage_id, author_id)
     do update set rating = excluded.rating, comment = excluded.comment`,
    [applicationId, app?.current_stage_id ?? null, user.id, rating, comment]
  );
  await audit(user.id, 'feedback', 'application', applicationId, { rating });
  revalidatePath(`/app/candidates/${applicationId}`);
}

export async function addNote(formData: FormData) {
  const user = await currentUser();
  const applicationId = Number(formData.get('applicationId'));
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

'use server';

import path from 'node:path';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { q, tx } from '@/lib/db';
import { currentUser, isStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { orgTimeToUtc } from '@/lib/tz';
import { EMPTY_SCHEMA, type FormSchema } from '@/lib/form-schema';
import { saveUpload } from '@/lib/storage';
import { POSTER_EXTS, POSTER_MAX_BYTES } from '@/lib/uploads';

const DEFAULT_STAGES: Array<[string, string]> = [
  ['Applied', 'screen'],
  ['Shortlist', 'screen'],
  ['Task', 'task'],
  ['Interview', 'interview'],
  ['Offer', 'offer'],
];

async function requireStaff() {
  const user = await currentUser();
  if (!isStaff(user)) throw new Error('Not allowed');
  return user;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'opening'
  );
}

export async function createOpening(formData: FormData) {
  const user = await requireStaff();
  const title = String(formData.get('title') ?? '').trim();
  const department = String(formData.get('department') ?? '').trim();
  if (!title) return;

  const base = slugify(title);
  const id = await tx(async (c) => {
    const { rows: taken } = await c.query(
      'select slug from public.openings where slug like $1',
      [`${base}%`]
    );
    const slugs = new Set(taken.map((r) => r.slug));
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;

    // slug races resolve without erroring (an insert error would abort the tx)
    let opening;
    for (let attempt = 0; !opening && attempt < 3; attempt++) {
      const trySlug = attempt === 0 ? slug : `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      ({
        rows: [opening],
      } = await c.query(
        `insert into public.openings (slug, title, department, created_by)
         values ($1, $2, $3, $4) on conflict (slug) do nothing returning id`,
        [trySlug, title, department, user.id]
      ));
    }
    if (!opening) throw new Error('Could not allocate a unique link for this opening');
    await c.query(
      `insert into public.forms (opening_id, schema) values ($1, $2)`,
      [opening.id, JSON.stringify(EMPTY_SCHEMA)]
    );
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      await c.query(
        `insert into public.stages (opening_id, name, kind, position) values ($1, $2, $3, $4)`,
        [opening.id, DEFAULT_STAGES[i][0], DEFAULT_STAGES[i][1], i]
      );
    }
    return opening.id as number;
  });
  await audit(user.id, 'create', 'opening', id, { title });
  redirect(`/app/openings/${id}`);
}

export async function updateOpening(formData: FormData) {
  await requireStaff();
  const id = Number(formData.get('id'));
  const status = String(formData.get('status') ?? 'draft');
  if (!['draft', 'open', 'paused', 'closed'].includes(status)) return;
  const newSlug = slugify(String(formData.get('slug') ?? ''));
  if (!newSlug) redirect(`/app/openings/${id}?e=slug`);
  try {
    await q(`update public.openings set slug = $2 where id = $1`, [id, newSlug]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') redirect(`/app/openings/${id}?e=slug`);
    throw err;
  }
  const closeDate = String(formData.get('close_date') ?? '');
  const closeAt = /^\d{4}-\d{2}-\d{2}$/.test(closeDate)
    ? orgTimeToUtc(closeDate, '23:59').toISOString()
    : null;

  // poster: null keeps the current one, '' removes it, a path replaces it
  let posterPath: string | null = null;
  const poster = formData.get('poster');
  if (poster instanceof File && poster.size > 0) {
    if (poster.size > POSTER_MAX_BYTES || !POSTER_EXTS.has(path.extname(poster.name).toLowerCase())) {
      redirect(`/app/openings/${id}?e=poster`);
    }
    posterPath = await saveUpload('posters', poster);
  } else if (formData.get('removePoster')) {
    posterPath = '';
  }

  await q(
    `update public.openings set title = $2, department = $3, description = $4, status = $5,
       location = $6, employment_type = $7, salary_range = $8, close_at = $9,
       notes = $10, consent_text = $11, poster_path = coalesce($12, poster_path)
     where id = $1`,
    [
      id,
      String(formData.get('title') ?? '').trim(),
      String(formData.get('department') ?? '').trim(),
      String(formData.get('description') ?? '').trim(),
      status,
      String(formData.get('location') ?? '').trim(),
      String(formData.get('employment_type') ?? '').trim(),
      String(formData.get('salary_range') ?? '').trim(),
      closeAt,
      String(formData.get('notes') ?? '').trim(),
      String(formData.get('consent_text') ?? '').trim().slice(0, 500),
      posterPath,
    ]
  );
  const user = await currentUser();
  await audit(user.id, 'update', 'opening', id, { status });
  revalidatePath(`/app/openings/${id}`);
  revalidatePath('/careers');
}

export async function saveDraftForm(openingId: number, schema: FormSchema) {
  const user = await requireStaff();
  await q(
    `update public.forms set schema = $2
     where opening_id = $1 and is_published = false
       and version = (select max(version) from public.forms where opening_id = $1 and is_published = false)`,
    [openingId, JSON.stringify(schema)]
  );
  await audit(user.id, 'save_form_draft', 'opening', openingId);
  revalidatePath(`/app/openings/${openingId}/form`);
}

export async function publishForm(openingId: number, schema: FormSchema) {
  const user = await requireStaff();
  await tx(async (c) => {
    // serialize concurrent publishes for this opening
    await c.query(`select id from public.openings where id = $1 for update`, [openingId]);
    // persist latest edits, then promote the draft and open a fresh one
    const {
      rows: [draft],
    } = await c.query(
      `update public.forms set schema = $2
       where opening_id = $1 and is_published = false
         and version = (select max(version) from public.forms where opening_id = $1 and is_published = false)
       returning id, version`,
      [openingId, JSON.stringify(schema)]
    );
    if (!draft) return;
    await c.query(
      `update public.forms set is_published = false where opening_id = $1 and is_published`,
      [openingId]
    );
    await c.query(`update public.forms set is_published = true where id = $1`, [draft.id]);
    await c.query(
      `insert into public.forms (opening_id, version, schema) values ($1, $2, $3)`,
      [openingId, draft.version + 1, JSON.stringify(schema)]
    );
  });
  await audit(user.id, 'publish_form', 'opening', openingId);
  revalidatePath(`/app/openings/${openingId}/form`);
  revalidatePath('/careers');
}

/** Latest question set from another opening, for reuse in the builder. */
export async function fetchOpeningQuestions(openingId: number) {
  await requireStaff();
  const {
    rows: [form],
  } = await q<{ schema: FormSchema }>(
    `select schema from public.forms where opening_id = $1
     order by is_published desc, version desc limit 1`,
    [openingId]
  );
  return form ? form.schema.pages.flatMap((p) => p.fields) : [];
}

// --- stages ---

const STAGE_KINDS = ['screen', 'task', 'interview', 'offer'];

export async function addStage(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  if (!STAGE_KINDS.includes(String(formData.get('kind')))) return;
  await audit(user.id, 'add_stage', 'opening', openingId, {
    name: String(formData.get('name') ?? ''),
  });
  await q(
    `insert into public.stages (opening_id, name, kind, position)
     values ($1, $2, $3, coalesce((select max(position) + 1 from public.stages where opening_id = $1), 0))`,
    [openingId, String(formData.get('name') ?? 'New stage').trim() || 'New stage', String(formData.get('kind') ?? 'screen')]
  );
  revalidatePath(`/app/openings/${openingId}/stages`);
}

export async function updateStage(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  if (!STAGE_KINDS.includes(String(formData.get('kind')))) return;
  await audit(user.id, 'update_stage', 'stage', Number(formData.get('stageId')));
  await q(
    `update public.stages set name = $2, kind = $3, brief = $4 where id = $1`,
    [
      Number(formData.get('stageId')),
      String(formData.get('name') ?? '').trim(),
      String(formData.get('kind') ?? 'screen'),
      String(formData.get('brief') ?? '').trim(),
    ]
  );
  revalidatePath(`/app/openings/${openingId}/stages`);
}

// bound with (openingId, stageId, dir) — submitter name/value is not
// delivered to formAction functions, so the args ride on the binding
export async function shiftStage(openingId: number, stageId: number, dir: number) {
  const user = await requireStaff();
  await audit(user.id, 'reorder_stage', 'stage', stageId, { dir });
  await tx(async (c) => {
    const { rows: stages } = await c.query(
      `select id, position from public.stages where opening_id = $1 order by position`,
      [openingId]
    );
    const i = stages.findIndex((s) => s.id === stageId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stages.length) return;
    await c.query(`update public.stages set position = $2 where id = $1`, [stages[i].id, stages[j].position]);
    await c.query(`update public.stages set position = $2 where id = $1`, [stages[j].id, stages[i].position]);
  });
  revalidatePath(`/app/openings/${openingId}/stages`);
}

export async function deleteStage(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const stageId = Number(formData.get('stageId'));
  const {
    rows: [{ active, booked }],
  } = await q<{ active: number; booked: number }>(
    `select
       (select count(*)::int from public.applications
         where current_stage_id = $1 and status = 'active') as active,
       (select count(*)::int from public.slots
         where stage_id = $1 and application_id is not null and starts_at > now()) as booked`,
    [stageId]
  );
  if (active > 0) throw new Error('Move candidates out of this stage first');
  if (booked > 0) throw new Error('This stage has booked future interviews — cancel them first');
  await tx(async (c) => {
    // don't orphan historical candidates: park them in the first remaining stage
    await c.query(
      `update public.applications set current_stage_id = (
         select id from public.stages where opening_id = $2 and id <> $1 order by position limit 1
       ) where current_stage_id = $1`,
      [stageId, openingId]
    );
    await c.query(`delete from public.stages where id = $1 and opening_id = $2`, [stageId, openingId]);
  });
  await audit(user.id, 'delete', 'stage', stageId);
  revalidatePath(`/app/openings/${openingId}/stages`);
}

// --- team ---

export async function addMember(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const memberId = String(formData.get('userId'));
  const memberRole = String(formData.get('memberRole'));
  if (!['requester', 'interviewer', 'viewer'].includes(memberRole)) return;
  await q(
    `insert into public.opening_members (opening_id, user_id, member_role)
     values ($1, $2, $3)
     on conflict (opening_id, user_id) do update set member_role = excluded.member_role`,
    [openingId, memberId, memberRole]
  );
  await audit(user.id, 'add_member', 'opening', openingId, { memberId, memberRole });
  revalidatePath(`/app/openings/${openingId}/team`);
}

export async function removeMember(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const memberId = String(formData.get('userId'));
  await q(`delete from public.opening_members where opening_id = $1 and user_id = $2`, [
    openingId,
    memberId,
  ]);
  await audit(user.id, 'remove_member', 'opening', openingId, { memberId });
  revalidatePath(`/app/openings/${openingId}/team`);
}

// --- interview slots ---

export async function createSlots(formData: FormData) {
  await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const stageId = Number(formData.get('stageId'));
  // first selected person is the primary interviewer; the rest form the panel
  const panelIds = formData.getAll('interviewerIds').map(String).filter(Boolean);
  const interviewerId = panelIds[0];
  const panel = panelIds.slice(1);
  if (!interviewerId) return;
  const date = String(formData.get('date')); // YYYY-MM-DD
  const from = String(formData.get('from')); // HH:MM
  const to = String(formData.get('to'));
  const duration = Math.max(5, Number(formData.get('duration')) || 30);
  const meetingLink = String(formData.get('meetingLink') ?? '').trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) return;

  // HR enters org-local wall time; store UTC regardless of server timezone
  const start = orgTimeToUtc(date, from);
  const end = orgTimeToUtc(date, to);
  const values: string[] = [];
  const params: unknown[] = [openingId, stageId, interviewerId, duration, meetingLink, panel];
  let p = params.length;
  for (let t = start; t.getTime() + duration * 60_000 <= end.getTime(); t = new Date(t.getTime() + duration * 60_000)) {
    values.push(`($1, $2, $3, $${++p}, $4, $5, $6)`);
    params.push(t.toISOString());
  }
  if (values.length === 0) return;
  await q(
    `insert into public.slots (opening_id, stage_id, interviewer_id, starts_at, duration_mins, meeting_link, panel)
     values ${values.join(', ')}`,
    params
  );
  const user = await currentUser();
  await audit(user.id, 'create_slots', 'opening', openingId, { count: values.length, date });
  revalidatePath(`/app/openings/${openingId}/slots`);
}

export async function deleteSlot(formData: FormData) {
  const user = await requireStaff();
  const openingId = Number(formData.get('openingId'));
  const slotId = Number(formData.get('slotId'));
  await q(`delete from public.slots where id = $1 and application_id is null`, [slotId]);
  await audit(user.id, 'delete', 'slot', slotId);
  revalidatePath(`/app/openings/${openingId}/slots`);
}

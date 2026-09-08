'use server';

import path from 'node:path';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { q, tx } from '@/lib/db';
import { canUseDepartment, currentUser, forbidden, requireAdmin, requireOpeningAccess, requireStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { orgTimeToUtc } from '@/lib/tz';
import { EMPTY_SCHEMA, type FormSchema } from '@/lib/form-schema';
import { parseSubmissionFields } from '@/lib/brief';
import { deleteFile, saveUpload } from '@/lib/storage';
import { POSTER_EXTS, POSTER_MAX_BYTES, TASK_MAX_BYTES, taskExt, uploadedPathRe } from '@/lib/uploads';

const DEFAULT_STAGES: Array<[string, string]> = [
  ['Applied', 'screen'],
  ['Shortlist', 'screen'],
  ['Task', 'task'],
  ['Task review', 'task_review'],
  ['Interview', 'interview'],
  ['Interview review', 'interview_review'],
  ['Offer', 'offer'],
];

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'opening'
  );
}

/** Is `name` one of the managed departments? Empty means "no department" (staff only). */
async function departmentListed(name: string): Promise<boolean> {
  if (!name) return true;
  const { rows } = await q(`select 1 from public.departments where name = $1`, [name]);
  return rows.length > 0;
}

export async function createOpening(formData: FormData) {
  const user = await currentUser();
  const title = String(formData.get('title') ?? '').trim().slice(0, 200);
  const department = String(formData.get('department') ?? '').trim().slice(0, 80);
  // global staff create anywhere; department members only inside their departments
  if (!(await canUseDepartment(user, department)) || (!department && user.role !== 'admin' && user.role !== 'hr')) forbidden();
  if (!(await departmentListed(department))) redirect('/app/openings?e=department');
  if (!title) redirect('/app/openings?e=title');

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
  const id = Number(formData.get('id'));
  const user = await requireOpeningAccess(id);
  const department = String(formData.get('department') ?? '').trim().slice(0, 80);
  const {
    rows: [cur],
  } = await q<{ department: string }>(`select department from public.openings where id = $1`, [id]);
  if (!cur) return;
  if (department !== cur.department) {
    // moving an opening between departments needs rights in the target department
    if (!(await canUseDepartment(user, department)) || !(await departmentListed(department))) {
      redirect(`/app/openings/${id}?e=department`);
    }
  }
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

  // text fields are saved first so a bad poster never discards what was typed
  await q(
    `update public.openings set title = $2, department = $3, description = $4, status = $5,
       location = $6, employment_type = $7, salary_range = $8, close_at = $9,
       notes = $10, consent_text = $11
     where id = $1`,
    [
      id,
      String(formData.get('title') ?? '').trim(),
      department,
      String(formData.get('description') ?? '').trim(),
      status,
      String(formData.get('location') ?? '').trim(),
      String(formData.get('employment_type') ?? '').trim(),
      String(formData.get('salary_range') ?? '').trim(),
      closeAt,
      String(formData.get('notes') ?? '').trim(),
      String(formData.get('consent_text') ?? '').trim().slice(0, 500),
    ]
  );
  await audit(user.id, 'update', 'opening', id, { status });
  revalidatePath('/careers');

  // poster: a new file replaces it, the checkbox removes it, otherwise unchanged
  const poster = formData.get('poster');
  if (poster instanceof File && poster.size > 0) {
    if (poster.size > POSTER_MAX_BYTES || !POSTER_EXTS.has(path.extname(poster.name).toLowerCase())) {
      redirect(`/app/openings/${id}?e=poster`);
    }
    await q(`update public.openings set poster_path = $2 where id = $1`, [id, await saveUpload('posters', poster)]);
  } else if (formData.get('removePoster')) {
    await q(`update public.openings set poster_path = '' where id = $1`, [id]);
  }
  redirect(`/app/openings/${id}?ok=saved`);
}

export async function saveDraftForm(openingId: number, schema: FormSchema) {
  const user = await requireOpeningAccess(openingId);
  await q(
    `update public.forms set schema = $2
     where opening_id = $1 and is_published = false
       and version = (select max(version) from public.forms where opening_id = $1 and is_published = false)`,
    [openingId, JSON.stringify(schema)]
  );
  await audit(user.id, 'save_form_draft', 'opening', openingId);
  revalidatePath(`/app/openings/${openingId}/form`);
}

export async function publishForm(openingId: number, schema: FormSchema): Promise<{ version: number | null }> {
  const user = await requireOpeningAccess(openingId);
  const version = await tx(async (c) => {
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
    if (!draft) return null;
    await c.query(
      `update public.forms set is_published = false where opening_id = $1 and is_published`,
      [openingId]
    );
    await c.query(`update public.forms set is_published = true where id = $1`, [draft.id]);
    await c.query(
      `insert into public.forms (opening_id, version, schema) values ($1, $2, $3)`,
      [openingId, draft.version + 1, JSON.stringify(schema)]
    );
    return Number(draft.version);
  });
  await audit(user.id, 'publish_form', 'opening', openingId, { version });
  revalidatePath(`/app/openings/${openingId}/form`);
  revalidatePath(`/app/openings/${openingId}`);
  revalidatePath('/careers');
  return { version };
}

/** Latest question set from another opening, for reuse in the builder. */
export async function fetchOpeningQuestions(openingId: number) {
  await requireOpeningAccess(openingId);
  const {
    rows: [form],
  } = await q<{ schema: FormSchema }>(
    `select schema from public.forms where opening_id = $1
     order by is_published desc, version desc limit 1`,
    [openingId]
  );
  return form ? form.schema.pages.flatMap((p) => p.fields) : [];
}

/**
 * Admin-only, irreversible: wipe an opening and everything under it —
 * applications, feedback, notes, history, emails, slots, forms, stages, and
 * every stored file. The UI requires typing the slug to confirm; download the
 * archive first.
 */
export async function deleteOpeningData(formData: FormData) {
  const user = await requireAdmin();
  const openingId = Number(formData.get('openingId'));
  const confirm = String(formData.get('confirmSlug') ?? '').trim();

  const {
    rows: [opening],
  } = await q<{ slug: string; poster_path: string }>(
    `select slug, poster_path from public.openings where id = $1`,
    [openingId]
  );
  if (!opening) return;
  if (confirm !== opening.slug) redirect(`/app/openings/${openingId}?e=confirm`);

  // collect file paths before the cascade removes the rows
  const { rows: files } = await q<{ p: string }>(
    `select resume_path as p from public.applications where opening_id = $1 and resume_path <> ''
     union all
     select s.file_path from public.submissions s
       join public.applications a on a.id = s.application_id
     where a.opening_id = $1 and s.file_path <> ''
     union all
     select brief_file_path from public.stages where opening_id = $1 and brief_file_path <> ''`,
    [openingId]
  );
  const {
    rows: [{ n: candidates }],
  } = await q<{ n: number }>(
    `select count(*)::int as n from public.applications where opening_id = $1`,
    [openingId]
  );

  await q(`delete from public.openings where id = $1`, [openingId]);
  for (const f of files) await deleteFile(f.p);
  if (opening.poster_path) await deleteFile(opening.poster_path);

  await audit(user.id, 'delete_opening_data', 'opening', openingId, {
    slug: opening.slug,
    candidates,
    files: files.length,
  });
  revalidatePath('/careers');
  redirect('/app/openings');
}

/**
 * Copy an opening's setup — stages (kinds, briefs, task days, submission
 * requirements), the latest form schema as a new draft, and team members — into
 * a new draft opening. Candidates, slots, and files are not copied.
 */
export async function cloneOpening(formData: FormData) {
  const sourceId = Number(formData.get('openingId'));
  const user = await requireStaff(); // creating openings is global-staff only, like createOpening
  const {
    rows: [src],
  } = await q<{ title: string; department: string; description: string; location: string; employment_type: string; salary_range: string; notes: string; consent_text: string }>(
    `select title, department, description, location, employment_type, salary_range, notes, consent_text
     from public.openings where id = $1`,
    [sourceId]
  );
  if (!src) return;
  const title = `${src.title} (copy)`.slice(0, 200);
  const base = slugify(title);
  const id = await tx(async (c) => {
    let opening;
    for (let attempt = 0; !opening && attempt < 4; attempt++) {
      const trySlug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      ({
        rows: [opening],
      } = await c.query(
        `insert into public.openings (slug, title, department, description, location, employment_type,
           salary_range, notes, consent_text, status, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10) on conflict (slug) do nothing returning id`,
        [trySlug, title, src.department, src.description, src.location, src.employment_type,
          src.salary_range, src.notes, src.consent_text, user.id]
      ));
    }
    if (!opening) throw new Error('Could not allocate a unique link for this opening');
    await c.query(
      `insert into public.forms (opening_id, schema)
       select $1, schema from public.forms where opening_id = $2
       order by is_published desc, version desc limit 1`,
      [opening.id, sourceId]
    );
    await c.query(
      `insert into public.stages (opening_id, name, kind, position, brief, brief_links, task_days, submission_fields)
       select $1, name, kind, position, brief, brief_links, task_days, submission_fields
       from public.stages where opening_id = $2`,
      [opening.id, sourceId]
    );
    await c.query(
      `insert into public.opening_members (opening_id, user_id, member_role)
       select $1, user_id, member_role from public.opening_members where opening_id = $2`,
      [opening.id, sourceId]
    );
    return opening.id as number;
  });
  await audit(user.id, 'clone', 'opening', id, { from: sourceId });
  redirect(`/app/openings/${id}`);
}

// --- stages ---

const STAGE_KINDS = ['screen', 'task', 'interview', 'offer'];

export async function addStage(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
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
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  if (!STAGE_KINDS.includes(String(formData.get('kind')))) return;
  await audit(user.id, 'update_stage', 'stage', Number(formData.get('stageId')));
  // brief is only written when the form carried it — task stages edit it on the Task tab
  await q(
    `update public.stages set name = coalesce(nullif($2, ''), name), kind = $3,
       brief = case when $4::boolean then $5 else brief end
     where id = $1 and opening_id = $6`,
    [
      Number(formData.get('stageId')),
      String(formData.get('name') ?? '').trim().slice(0, 100),
      String(formData.get('kind') ?? 'screen'),
      formData.has('brief'),
      String(formData.get('brief') ?? '').trim(),
      openingId,
    ]
  );
  revalidatePath(`/app/openings/${openingId}/stages`);
}

/** Save a task stage's brief text, reference links, and optional document. */
export async function updateTaskMaterials(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  const stageId = Number(formData.get('stageId'));

  const {
    rows: [stage],
  } = await q<{ brief_file_path: string }>(
    `select brief_file_path from public.stages where id = $1 and opening_id = $2 and kind = 'task'`,
    [stageId, openingId]
  );
  if (!stage) return;

  // document: null keeps the current one, '' removes it, a path replaces it
  let docPath: string | null = null;
  const doc = formData.get('document');
  const preUploaded = String(formData.get('documentPath') ?? '');
  if (preUploaded) {
    // browser already uploaded straight to storage (Vercel body-size cap)
    if (!uploadedPathRe('briefs').test(preUploaded)) redirect(`/app/openings/${openingId}/task?e=file`);
    docPath = preUploaded;
  } else if (doc instanceof File && doc.size > 0) {
    if (doc.size > TASK_MAX_BYTES || taskExt(doc.name) === null) {
      redirect(`/app/openings/${openingId}/task?e=file`);
    }
    docPath = await saveUpload('briefs', doc);
  } else if (formData.get('removeDocument')) {
    docPath = '';
  }

  // keep only http(s) lines so the portal never renders junk as a link
  const links = String(formData.get('links') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, 20)
    .join('\n');

  let fields: unknown = [];
  try {
    fields = JSON.parse(String(formData.get('submissionFields') ?? '[]'));
  } catch {
    /* malformed client JSON → keep empty */
  }

  await q(
    `update public.stages set brief = $2, brief_links = $3,
       brief_file_path = coalesce($4, brief_file_path),
       submission_fields = $5, task_days = $6
     where id = $1`,
    [
      stageId,
      String(formData.get('brief') ?? '').trim(),
      links,
      docPath,
      JSON.stringify(parseSubmissionFields(fields)),
      Math.min(365, Math.max(0, Math.floor(Number(formData.get('taskDays')) || 0))),
    ]
  );
  if (docPath !== null && stage.brief_file_path) await deleteFile(stage.brief_file_path);

  await audit(user.id, 'update_task_materials', 'stage', stageId);
}

// bound with (openingId, stageId, dir) — submitter name/value is not
// delivered to formAction functions, so the args ride on the binding
export async function shiftStage(openingId: number, stageId: number, dir: number) {
  const user = await requireOpeningAccess(openingId);
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
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
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
  const {
    rows: [owned],
  } = await q(`select 1 from public.stages where id = $1 and opening_id = $2`, [stageId, openingId]);
  if (!owned) return;
  if (active > 0) redirect(`/app/openings/${openingId}/stages?e=hasCandidates`);
  if (booked > 0) redirect(`/app/openings/${openingId}/stages?e=hasBookings`);
  const {
    rows: [old],
  } = await q<{ brief_file_path: string }>(
    `select brief_file_path from public.stages where id = $1`,
    [stageId]
  );
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
  if (old?.brief_file_path) await deleteFile(old.brief_file_path);
  await audit(user.id, 'delete', 'stage', stageId);
}

// --- team ---

export async function addMember(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  const memberId = String(formData.get('userId'));
  // member_role is a label now (every member can do everything in the
  // opening); derive it from the person's global role for the archive/team lists
  const {
    rows: [person],
  } = await q<{ role: string }>(`select role from public.profiles where id = $1`, [memberId]);
  if (!person) return;
  const memberRole = person.role === 'interviewer' ? 'interviewer' : 'requester';
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
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
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
  const openingId = Number(formData.get('openingId'));
  const stageId = Number(formData.get('stageId'));
  const user = await requireOpeningAccess(openingId);
  const back = `/app/openings/${openingId}/slots`;
  const {
    rows: [stageOk],
  } = await q(`select 1 from public.stages where id = $1 and opening_id = $2 and kind = 'interview'`, [stageId, openingId]);
  if (!stageOk) redirect(`${back}?e=stage`);
  // primary interviewer + panel checkboxes (legacy multi-select: first = primary)
  const legacy = formData.getAll('interviewerIds').map(String).filter(Boolean);
  const interviewerId = String(formData.get('interviewerId') ?? '') || legacy[0];
  const panel = [...new Set([...formData.getAll('panelIds').map(String), ...legacy.slice(1)])].filter(
    (id) => id && id !== interviewerId
  );
  if (!interviewerId) redirect(`${back}?e=interviewer`);
  const date = String(formData.get('date')); // YYYY-MM-DD
  const from = String(formData.get('from')); // HH:MM
  const to = String(formData.get('to'));
  const duration = Math.max(5, Number(formData.get('duration')) || 30);
  const meetingLink = String(formData.get('meetingLink') ?? '').trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    redirect(`${back}?e=window`);
  }

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
  if (values.length === 0) redirect(`${back}?e=window`);
  await q(
    `insert into public.slots (opening_id, stage_id, interviewer_id, starts_at, duration_mins, meeting_link, panel)
     values ${values.join(', ')}`,
    params
  );
  await audit(user.id, 'create_slots', 'opening', openingId, { count: values.length, date });
  revalidatePath(back);
  redirect(`${back}?ok=slots:${values.length}`);
}

export async function deleteSlot(formData: FormData) {
  const openingId = Number(formData.get('openingId'));
  const user = await requireOpeningAccess(openingId);
  const slotId = Number(formData.get('slotId'));
  await q(`delete from public.slots where id = $1 and opening_id = $2 and application_id is null`, [slotId, openingId]);
  await audit(user.id, 'delete', 'slot', slotId);
  revalidatePath(`/app/openings/${openingId}/slots`);
}

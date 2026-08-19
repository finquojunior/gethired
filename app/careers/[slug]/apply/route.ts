import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q, tx } from '@/lib/db';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { portalUrl, sendEmail } from '@/lib/email';
import { RESUME_EXTS, RESUME_MAX_BYTES, saveUpload } from '@/lib/storage';
import { computeMaxScore, computeScore, validateAnswers, type FormSchema } from '@/lib/form-schema';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!rateLimit(`apply:${clientIp(req.headers)}`, 10, 5 * 60_000)) {
    return NextResponse.json({ message: 'Too many submissions — try again in a few minutes.' }, { status: 429 });
  }
  // reject oversized bodies before buffering the multipart payload
  if (Number(req.headers.get('content-length') ?? 0) > RESUME_MAX_BYTES + 512 * 1024) {
    return NextResponse.json({ message: 'Submission too large.' }, { status: 413 });
  }
  const fd = await req.formData();

  const {
    rows: [form],
  } = await q<{ opening_id: number; form_id: number; schema: FormSchema }>(
    `select o.id as opening_id, f.id as form_id, f.schema
     from public.openings o
     join public.forms f on f.opening_id = o.id and f.is_published
     where o.slug = $1 and o.status = 'open'
       and (o.close_at is null or o.close_at > now())`,
    [slug]
  );
  if (!form || form.form_id !== Number(fd.get('formId'))) {
    return NextResponse.json(
      { message: 'This role is no longer accepting applications. Refresh the page.' },
      { status: 409 }
    );
  }

  const name = String(fd.get('name') ?? '').trim().slice(0, 200);
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const phone = String(fd.get('phone') ?? '').trim().slice(0, 50);
  const resume = fd.get('resume');
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Enter your name';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email';
  if (!(resume instanceof File) || resume.size === 0) {
    errors.resume = 'Attach your resume';
  } else if (resume.size > RESUME_MAX_BYTES) {
    errors.resume = 'Resume must be 5 MB or smaller';
  } else if (!RESUME_EXTS.has(path.extname(resume.name).toLowerCase())) {
    errors.resume = 'Use PDF or Word format';
  }

  let answers: Record<string, unknown>;
  const answersRaw = String(fd.get('answers') ?? '{}');
  if (answersRaw.length > 200_000) {
    return NextResponse.json({ message: 'Submission too large.' }, { status: 413 });
  }
  try {
    answers = JSON.parse(answersRaw);
  } catch {
    return NextResponse.json({ message: 'Invalid submission.' }, { status: 400 });
  }
  const validated = validateAnswers(form.schema, answers as never);
  Object.assign(errors, validated.errors);
  if (!fd.get('consent')) {
    errors.consent = 'Consent is required to submit an application';
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors, message: 'Fix the highlighted fields.' }, { status: 400 });
  }

  // ad-source tracking: whitelist utm_* keys, cap lengths
  let utm: Record<string, string> = {};
  try {
    const raw = JSON.parse(String(fd.get('utm') ?? '{}'));
    for (const k of UTM_KEYS) {
      if (typeof raw[k] === 'string' && raw[k]) utm[k] = raw[k].slice(0, 200);
    }
  } catch {
    utm = {};
  }

  const relPath = await saveUpload('resumes', resume as File);
  const score = computeScore(form.schema, validated.clean);
  const maxScore = computeMaxScore(form.schema);
  let created: { id: number; portal_token: string; title: string } | undefined;
  try {
    await tx(async (c) => {
      const {
        rows: [stage],
      } = await c.query(
        `select id from public.stages where opening_id = $1 order by position limit 1`,
        [form.opening_id]
      );
      const {
        rows: [app],
      } = await c.query(
        `insert into public.applications
           (opening_id, form_id, name, email, phone, resume_path, answers, score, max_score, utm, current_stage_id, consented_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         returning id, portal_token`,
        [
          form.opening_id,
          form.form_id,
          name,
          email,
          phone,
          relPath,
          JSON.stringify(validated.clean),
          score,
          maxScore,
          JSON.stringify(utm),
          stage?.id ?? null,
        ]
      );
      if (stage) {
        await c.query(
          `insert into public.stage_history (application_id, to_stage_id) values ($1, $2)`,
          [app.id, stage.id]
        );
      }
      const {
        rows: [o],
      } = await c.query('select title from public.openings where id = $1', [form.opening_id]);
      created = { id: app.id, portal_token: app.portal_token, title: o.title };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json(
        { message: 'You have already applied for this role with this email.' },
        { status: 409 }
      );
    }
    throw e;
  }

  if (created) {
    await audit(null, 'applied', 'application', created.id, { opening: created.title });
    await sendEmail({
      applicationId: created.id,
      template: 'application_received',
      to: email,
      vars: { name, role: created.title, portal_link: portalUrl(created.portal_token) },
    });
  }

  return NextResponse.json({ ok: true });
}

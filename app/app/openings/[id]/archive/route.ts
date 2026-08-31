import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { currentUserOrNull } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { readFileBuffer } from '@/lib/storage';
import { buildZip } from '@/lib/zip';

export const maxDuration = 300;

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60);
const csv = (v: unknown) => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Admin-only: full archive of one opening — data as JSON/CSV plus all files. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUserOrNull();
  if (!user || user.role !== 'admin') return new NextResponse('Forbidden', { status: 403 });
  const { id } = await ctx.params;
  const openingId = Number(id);

  const {
    rows: [opening],
  } = await q(`select * from public.openings where id = $1`, [openingId]);
  if (!opening) return new NextResponse('Not found', { status: 404 });

  const [{ rows: stages }, { rows: forms }, { rows: members }, { rows: apps }] = await Promise.all([
    q(`select * from public.stages where opening_id = $1 order by position`, [openingId]),
    q(`select id, version, schema, is_published, created_at from public.forms where opening_id = $1 order by version`, [openingId]),
    q(
      `select p.full_name, m.member_role from public.opening_members m
       join public.profiles p on p.id = m.user_id where m.opening_id = $1`,
      [openingId]
    ),
    q<Record<string, unknown> & { id: number; name: string; resume_path: string }>(
      `select a.*, s.name as stage_name from public.applications a
       left join public.stages s on s.id = a.current_stage_id
       where a.opening_id = $1 order by a.id`,
      [openingId]
    ),
  ]);

  const appIds = apps.map((a) => a.id);
  const [{ rows: feedback }, { rows: notes }, { rows: history }, { rows: emails }, { rows: submissions }] =
    await Promise.all([
      q(
        `select f.application_id, p.full_name as author, f.rating, f.comment, f.created_at
         from public.feedback f join public.profiles p on p.id = f.author_id
         where f.application_id = any($1)`,
        [appIds]
      ),
      q(
        `select n.application_id, p.full_name as author, n.body, n.created_at
         from public.notes n join public.profiles p on p.id = n.author_id
         where n.application_id = any($1)`,
        [appIds]
      ),
      q(`select * from public.stage_history where application_id = any($1) order by id`, [appIds]),
      q(
        `select application_id, template, to_email, subject, status, sent_at, created_at
         from public.email_log where application_id = any($1) order by id`,
        [appIds]
      ),
      q<{ application_id: number; file_path: string; note: string; created_at: Date }>(
        `select application_id, title, file_path, link_url, note, created_at from public.submissions
         where application_id = any($1)`,
        [appIds]
      ),
    ]);

  const entries: { name: string; data: Buffer }[] = [];
  entries.push({
    name: 'opening.json',
    data: Buffer.from(JSON.stringify({ opening, stages, forms, members }, null, 2)),
  });
  entries.push({
    name: 'candidates.json',
    data: Buffer.from(
      JSON.stringify({ applications: apps, feedback, notes, stage_history: history, emails, submissions }, null, 2)
    ),
  });

  const header = ['Id', 'Name', 'Email', 'Phone', 'Status', 'Stage', 'Score', 'Applied', 'Consented'];
  const lines = [header.join(',')];
  for (const a of apps) {
    lines.push(
      [a.id, a.name, a.email, a.phone, a.status, a.stage_name, a.score, a.created_at, a.consented_at]
        .map(csv)
        .join(',')
    );
  }
  entries.push({ name: 'candidates.csv', data: Buffer.from(lines.join('\n')) });

  for (const a of apps) {
    if (typeof a.resume_path === 'string' && a.resume_path) {
      const buf = await readFileBuffer(a.resume_path);
      if (buf) entries.push({ name: `resumes/${a.id}-${safe(a.name)}${path.extname(a.resume_path)}`, data: buf });
    }
  }
  for (const s of submissions) {
    if (s.file_path) {
      const buf = await readFileBuffer(s.file_path);
      const cand = apps.find((a) => a.id === s.application_id);
      if (buf)
        entries.push({
          name: `submissions/${s.application_id}-${safe(String(cand?.name ?? 'candidate'))}${path.extname(s.file_path)}`,
          data: buf,
        });
    }
  }
  const posterPath = String(opening.poster_path ?? '');
  if (posterPath) {
    const buf = await readFileBuffer(posterPath);
    if (buf) entries.push({ name: `poster${path.extname(posterPath)}`, data: buf });
  }

  await audit(user.id, 'archive_download', 'opening', openingId, { candidates: apps.length });
  const zip = buildZip(entries);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(zip.length),
      'content-disposition': `attachment; filename="${safe(String(opening.slug))}-archive.zip"`,
    },
  });
}

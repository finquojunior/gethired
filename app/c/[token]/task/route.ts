import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { saveUpload, TASK_EXTS, TASK_MAX_BYTES } from '@/lib/storage';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);
  if (!rateLimit(`task:${clientIp(req.headers)}`, 10, 5 * 60_000)) return back('?e=file');
  // reject oversized bodies before buffering the multipart payload
  if (Number(req.headers.get('content-length') ?? 0) > TASK_MAX_BYTES + 512 * 1024) {
    return back('?e=file');
  }

  const {
    rows: [a],
  } = await q<{ id: number; stage_id: number | null; kind: string | null }>(
    `select a.id, a.current_stage_id as stage_id, s.kind
     from public.applications a
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || a.kind !== 'task') return back();

  const fd = await req.formData();
  const file = fd.get('file');
  const note = String(fd.get('note') ?? '').trim().slice(0, 2000);
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > TASK_MAX_BYTES ||
    !TASK_EXTS.has(path.extname(file.name).toLowerCase())
  ) {
    return back('?e=file');
  }

  const relPath = await saveUpload('submissions', file);
  await q(
    `insert into public.submissions (application_id, stage_id, file_path, note) values ($1, $2, $3, $4)`,
    [a.id, a.stage_id, relPath, note]
  );
  await audit(null, 'submitted_task', 'application', a.id);
  return back();
}

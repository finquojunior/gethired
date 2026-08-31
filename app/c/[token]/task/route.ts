import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { verifyUploadPath } from '@/lib/auth';
import { saveUpload, TASK_EXTS, TASK_MAX_BYTES } from '@/lib/storage';
import { uploadedPathRe } from '@/lib/uploads';
import { parseSubmissionFields } from '@/lib/brief';

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
  } = await q<{ id: number; stage_id: number | null; kind: string | null; submission_fields: unknown }>(
    `select a.id, a.current_stage_id as stage_id, s.kind, s.submission_fields
     from public.applications a
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || a.kind !== 'task') return back();

  const fd = await req.formData();
  const file = fd.get('file');
  const note = String(fd.get('note') ?? '').trim().slice(0, 2000);

  // a submission either answers an admin-defined requirement (field id wins:
  // the title and kind come from the definition) or is free-form with a title
  const fieldId = String(fd.get('field') ?? '');
  const field = fieldId
    ? parseSubmissionFields(a.submission_fields).find((f) => f.id === fieldId)
    : undefined;
  if (fieldId && !field) return back('?e=file');

  const title = field?.title ?? String(fd.get('title') ?? '').trim().slice(0, 200);
  const link = String(fd.get('link') ?? '').trim().slice(0, 500);
  if (!title) return back('?e=file');
  if (link && !/^https?:\/\//i.test(link)) return back('?e=file');

  // browser already uploaded straight to storage (Vercel body-size cap); the
  // signed path proves we minted it for this application
  const pre = String(fd.get('filePath') ?? '');
  let relPath = '';
  if (pre) {
    if (!uploadedPathRe('submissions').test(pre) || !verifyUploadPath(a.id, pre, String(fd.get('fileSig') ?? ''))) {
      return back('?e=file');
    }
    relPath = pre;
  } else if (file instanceof File && file.size > 0) {
    if (file.size > TASK_MAX_BYTES || !TASK_EXTS.has(path.extname(file.name).toLowerCase())) {
      return back('?e=file');
    }
    relPath = await saveUpload('submissions', file);
  }

  // every submission needs something in it, matching its requirement's kind
  const wrongKind = field && ((field.kind === 'file' && !relPath) || (field.kind === 'link' && !link));
  if ((!relPath && !link) || wrongKind) return back('?e=file');

  await q(
    `insert into public.submissions (application_id, stage_id, field_id, title, file_path, link_url, note) values ($1, $2, $3, $4, $5, $6, $7)`,
    [a.id, a.stage_id, field?.id ?? '', title, relPath, link, note]
  );
  await audit(null, 'submitted_task', 'application', a.id);
  return back();
}

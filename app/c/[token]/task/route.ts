import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { verifyUploadPath } from '@/lib/auth';
import { saveUpload, TASK_EXTS, TASK_MAX_BYTES } from '@/lib/storage';
import { uploadedPathRe } from '@/lib/uploads';
import { parseSubmissionFields } from '@/lib/brief';

// One POST submits the whole task: per requirement, either a browser-direct
// uploaded path (filePath_<id> + fileSig_<id>), a multipart file (file_<id>,
// local dev), and/or a link (link_<id>). Required items must have content now
// or an earlier submission. Inserts one row per filled item, atomically.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);
  if (!rateLimit(`task:${clientIp(req.headers)}`, 10, 5 * 60_000)) return back('?e=file');
  // reject oversized bodies before buffering the multipart payload (several
  // files ride through the server only in local dev — prod uploads directly)
  if (Number(req.headers.get('content-length') ?? 0) > 4 * TASK_MAX_BYTES + 512 * 1024) {
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

  const fields = parseSubmissionFields(a.submission_fields);
  if (fields.length === 0) return back(); // no requirements defined → no submissions

  const fd = await req.formData();
  const note = String(fd.get('note') ?? '').trim().slice(0, 2000);

  const { rows: existing } = await q<{ field_id: string }>(
    `select distinct field_id from public.submissions where application_id = $1 and stage_id = $2`,
    [a.id, a.stage_id]
  );
  const alreadyDone = new Set(existing.map((r) => r.field_id));

  const rows: Array<{ fieldId: string; title: string; filePath: string; link: string }> = [];
  for (const f of fields) {
    const link =
      f.kind !== 'file' ? String(fd.get(`link_${f.id}`) ?? '').trim().slice(0, 500) : '';
    if (link && !/^https?:\/\//i.test(link)) return back('?e=file');

    let relPath = '';
    if (f.kind !== 'link') {
      // browser already uploaded straight to storage (Vercel body-size cap);
      // the signed path proves we minted it for this application
      const pre = String(fd.get(`filePath_${f.id}`) ?? '');
      if (pre) {
        if (
          !uploadedPathRe('submissions').test(pre) ||
          !verifyUploadPath(a.id, pre, String(fd.get(`fileSig_${f.id}`) ?? ''))
        ) {
          return back('?e=file');
        }
        relPath = pre;
      } else {
        const file = fd.get(`file_${f.id}`);
        if (file instanceof File && file.size > 0) {
          if (file.size > TASK_MAX_BYTES || !TASK_EXTS.has(path.extname(file.name).toLowerCase())) {
            return back('?e=file');
          }
          relPath = await saveUpload('submissions', file);
        }
      }
    }

    if (relPath || link) {
      rows.push({ fieldId: f.id, title: f.title, filePath: relPath, link });
    } else if (f.required && !alreadyDone.has(f.id)) {
      return back('?e=file');
    }
  }
  if (rows.length === 0) return back('?e=file'); // nothing new attached

  const values: string[] = [];
  const params: unknown[] = [a.id, a.stage_id];
  let p = params.length;
  for (const [i, r] of rows.entries()) {
    values.push(`($1, $2, $${++p}, $${++p}, $${++p}, $${++p}, $${++p})`);
    params.push(r.fieldId, r.title, r.filePath, r.link, i === 0 ? note : '');
  }
  await q(
    `insert into public.submissions (application_id, stage_id, field_id, title, file_path, link_url, note)
     values ${values.join(', ')}`,
    params
  );
  await audit(null, 'submitted_task', 'application', a.id);
  return back('?ok=task');
}

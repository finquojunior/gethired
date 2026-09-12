import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { verifyUploadPath } from '@/lib/auth';
import { saveUpload, TASK_MAX_BYTES } from '@/lib/storage';
import { taskExt, uploadedPathRe } from '@/lib/uploads';
import { parseSubmissionFields, FALLBACK_REQUIREMENT } from '@/lib/brief';
import { portalUrl, sendEmail } from '@/lib/email';

/** Original filename for display: bounded, no path separators. */
const cleanName = (n: string) => n.replace(/[\\/]/g, '_').trim().slice(0, 200);

// One POST submits the whole task: per requirement, either a browser-direct
// uploaded path (filePath_<id> + fileSig_<id>), a multipart file (file_<id>,
// local dev), and/or a link (link_<id>). Required items must have content now
// or an earlier submission. Inserts one row per filled item, atomically.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);
  if (!rateLimit(`task:${clientIp(req.headers)}`, 10, 5 * 60_000)) return back('?e=ratelimit');
  // reject oversized bodies before buffering the multipart payload (several
  // files ride through the server only in local dev — prod uploads directly)
  if (Number(req.headers.get('content-length') ?? 0) > 4 * TASK_MAX_BYTES + 512 * 1024) {
    return back('?e=size');
  }

  const {
    rows: [a],
  } = await q<{
    id: number;
    name: string;
    email: string;
    title: string;
    stage_id: number | null;
    kind: string | null;
    submission_fields: unknown;
  }>(
    `select a.id, a.name, a.email, o.title, a.current_stage_id as stage_id, s.kind, s.submission_fields
     from public.applications a
     join public.openings o on o.id = a.opening_id
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || a.kind !== 'task') return back('?e=oops');

  // no requirements defined → one generic "Your work" item, same as the portal renders
  const parsed = parseSubmissionFields(a.submission_fields);
  const fields = parsed.length > 0 ? parsed : [FALLBACK_REQUIREMENT];

  const fd = await req.formData();
  const note = String(fd.get('note') ?? '').trim().slice(0, 2000);

  const { rows: existing } = await q<{ field_id: string }>(
    `select distinct field_id from public.submissions where application_id = $1 and stage_id = $2`,
    [a.id, a.stage_id]
  );
  const alreadyDone = new Set(existing.map((r) => r.field_id));

  const rows: Array<{ fieldId: string; title: string; filePath: string; fileName: string; link: string }> = [];
  for (const f of fields) {
    const link =
      f.kind !== 'file' ? String(fd.get(`link_${f.id}`) ?? '').trim().slice(0, 500) : '';
    if (link && !/^https?:\/\//i.test(link)) return back('?e=link');

    let relPath = '';
    let fileName = '';
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
        fileName = cleanName(String(fd.get(`fileName_${f.id}`) ?? ''));
      } else {
        const file = fd.get(`file_${f.id}`);
        if (file instanceof File && file.size > 0) {
          if (file.size > TASK_MAX_BYTES) return back('?e=size');
          if (taskExt(file.name) === null) return back('?e=type');
          relPath = await saveUpload('submissions', file);
          fileName = cleanName(file.name);
        }
      }
    }

    if (relPath || link) {
      rows.push({ fieldId: f.id, title: f.title, filePath: relPath, fileName, link });
    } else if (f.required && !alreadyDone.has(f.id)) {
      return back('?e=required');
    }
  }
  if (rows.length === 0) return back('?e=nothing'); // nothing new attached

  const values: string[] = [];
  const params: unknown[] = [a.id, a.stage_id];
  let p = params.length;
  for (const [i, r] of rows.entries()) {
    values.push(`($1, $2, $${++p}, $${++p}, $${++p}, $${++p}, $${++p}, $${++p})`);
    params.push(r.fieldId, r.title, r.filePath, r.fileName, r.link, i === 0 ? note : '');
  }
  await q(
    `insert into public.submissions (application_id, stage_id, field_id, title, file_path, file_name, link_url, note)
     values ${values.join(', ')}`,
    params
  );
  await audit(null, 'submitted_task', 'application', a.id);
  await sendEmail({
    applicationId: a.id,
    template: 'task_received',
    to: a.email,
    vars: {
      name: a.name,
      role: a.title,
      items: rows
        .map((r) => `• ${r.title}: ${[r.fileName || (r.filePath && 'file'), r.link].filter(Boolean).join(' + ')}`)
        .join('\n'),
      portal_link: portalUrl(token),
    },
  }).catch((e) => console.error('task_received email failed', e));
  return back('?ok=task');
}

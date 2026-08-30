import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { signUploadPath } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { createSignedUpload } from '@/lib/storage';
import { TASK_EXTS } from '@/lib/uploads';

/** Candidate: mint a direct upload URL for a task submission. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!rateLimit(`upload-url:${clientIp(req.headers)}`, 10, 5 * 60_000)) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  const {
    rows: [a],
  } = await q<{ id: number; kind: string | null }>(
    `select a.id, s.kind
     from public.applications a
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || a.kind !== 'task') return new NextResponse('Not found', { status: 404 });

  const { name } = await req.json().catch(() => ({ name: '' }));
  const ext = path.extname(String(name ?? '')).toLowerCase();
  if (!TASK_EXTS.has(ext)) return new NextResponse('Bad file type', { status: 400 });

  const signed = await createSignedUpload('submissions', ext);
  if (!signed) return new NextResponse('Direct upload unavailable', { status: 404 });
  return NextResponse.json({ ...signed, sig: signUploadPath(a.id, signed.path) });
}

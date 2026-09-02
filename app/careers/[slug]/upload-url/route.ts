import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { signUploadPath } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { createSignedUpload } from '@/lib/storage';
import { RESUME_EXTS } from '@/lib/uploads';

/** Public: mint a browser-direct upload URL for a resume (Vercel caps request bodies at 4.5MB). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!rateLimit(`upload-url:${clientIp(req.headers)}`, 20, 5 * 60_000)) {
    return new NextResponse('Too many requests', { status: 429 });
  }
  const {
    rows: [o],
  } = await q(`select 1 from public.openings where slug = $1 and status = 'open'`, [slug]);
  if (!o) return new NextResponse('Not found', { status: 404 });

  const { name } = await req.json().catch(() => ({ name: '' }));
  const ext = path.extname(String(name ?? '')).toLowerCase();
  if (!RESUME_EXTS.has(ext)) return new NextResponse('Bad file type', { status: 400 });

  const signed = await createSignedUpload('resumes', ext);
  if (!signed) return new NextResponse('Direct upload unavailable', { status: 404 });
  // no application exists yet — sign with id 0 so the apply route can verify we minted it
  return NextResponse.json({ ...signed, sig: signUploadPath(0, signed.path) });
}

import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { canAccessOpening, currentUserOrNull, signUploadPath } from '@/lib/auth';
import { createSignedUpload } from '@/lib/storage';
import { RESUME_EXTS } from '@/lib/uploads';

/** Staff-only: mint a browser-direct upload URL for a walk-in candidate's resume. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUserOrNull();
  const { id } = await ctx.params;
  if (!user || !(await canAccessOpening(user, Number(id)))) return new NextResponse('Forbidden', { status: 403 });

  const { name } = await req.json().catch(() => ({ name: '' }));
  const ext = path.extname(String(name ?? '')).toLowerCase();
  if (!RESUME_EXTS.has(ext)) return new NextResponse('Bad file type', { status: 400 });

  const signed = await createSignedUpload('resumes', ext);
  if (!signed) return new NextResponse('Direct upload unavailable', { status: 404 });
  // no application exists yet — sign with id 0, same as the public apply flow
  return NextResponse.json({ ...signed, sig: signUploadPath(0, signed.path) });
}

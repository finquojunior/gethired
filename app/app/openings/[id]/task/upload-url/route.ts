import { NextResponse, type NextRequest } from 'next/server';
import { canAccessOpening, currentUserOrNull } from '@/lib/auth';
import { createSignedUpload } from '@/lib/storage';
import { taskExt } from '@/lib/uploads';

/** Staff-only: mint a direct upload URL for a task brief document. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUserOrNull();
  const { id } = await ctx.params;
  if (!user || !(await canAccessOpening(user, Number(id)))) return new NextResponse('Forbidden', { status: 403 });

  const { name } = await req.json().catch(() => ({ name: '' }));
  const ext = taskExt(String(name ?? ''));
  if (ext === null) return new NextResponse('Bad file type', { status: 400 });

  const signed = await createSignedUpload('briefs', ext);
  if (!signed) return new NextResponse('Direct upload unavailable', { status: 404 });
  return NextResponse.json(signed);
}

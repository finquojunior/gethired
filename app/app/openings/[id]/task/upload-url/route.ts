import { NextResponse, type NextRequest } from 'next/server';
import { currentUserOrNull, isStaff } from '@/lib/auth';
import { createSignedUpload } from '@/lib/storage';
import { taskExt } from '@/lib/uploads';

/** Staff-only: mint a direct upload URL for a task brief document. */
export async function POST(req: NextRequest) {
  const user = await currentUserOrNull();
  if (!user || !isStaff(user)) return new NextResponse('Forbidden', { status: 403 });

  const { name } = await req.json().catch(() => ({ name: '' }));
  const ext = taskExt(String(name ?? ''));
  if (ext === null) return new NextResponse('Bad file type', { status: 400 });

  const signed = await createSignedUpload('briefs', ext);
  if (!signed) return new NextResponse('Direct upload unavailable', { status: 404 });
  return NextResponse.json(signed);
}

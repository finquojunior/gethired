import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { currentUserOrNull, isStaff } from '@/lib/auth';
import { getFile } from '@/lib/storage';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  // role posters are public marketing assets; everything else is staff-only
  if (parts[0] !== 'posters') {
    const user = await currentUserOrNull();
    if (!user || !isStaff(user)) return new NextResponse('Forbidden', { status: 403 });
  }

  const file = await getFile(parts);
  if (!file) return new NextResponse('Not found', { status: 404 });
  const ext = path.extname(parts[parts.length - 1] ?? '').toLowerCase();
  return new NextResponse(file.body, {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      ...(file.size ? { 'content-length': String(file.size) } : {}),
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      ...(parts[0] === 'posters' ? { 'cache-control': 'public, max-age=3600' } : {}),
      // untrusted uploads: no scripts, no same-origin access even if rendered.
      // PDFs skip the sandbox so the browser viewer works — nosniff + forced
      // content-type keeps disguised HTML inert.
      ...(ext === '.pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'" }),
    },
  });
}

import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { getFile } from '@/lib/storage';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
};

/** Candidate download of the task brief document, gated by portal token. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const {
    rows: [a],
  } = await q<{ brief_file_path: string | null; kind: string | null }>(
    `select s.brief_file_path, s.kind
     from public.applications a
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || a.kind !== 'task' || !a.brief_file_path) {
    return new NextResponse('Not found', { status: 404 });
  }

  const file = await getFile(a.brief_file_path.split('/'));
  if (!file) return new NextResponse('Not found', { status: 404 });
  const ext = path.extname(a.brief_file_path).toLowerCase();
  return new NextResponse(file.body, {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      ...(file.size ? { 'content-length': String(file.size) } : {}),
      'content-disposition': `attachment; filename="task-brief${ext}"`,
      'x-content-type-options': 'nosniff',
    },
  });
}

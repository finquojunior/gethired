import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';

// File store with two backends:
//  - Supabase Storage (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set)
//    — required on Vercel, where the local filesystem is ephemeral
//  - local disk under db/files (dev fallback)
// Relative paths ("resumes/ab12….pdf") are identical in both backends, so
// nothing else in the app knows which one is active.

export const FILES_ROOT = path.join(process.cwd(), 'db', 'files');
export { RESUME_MAX_BYTES, RESUME_EXTS, TASK_MAX_BYTES, TASK_EXTS } from '@/lib/uploads';

const SUPA = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
// accept both the classic service_role key and the new-style secret key that
// the Vercel-Supabase integration provisions
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const useSupabase = Boolean(SUPA && SUPA_KEY);

if (process.env.VERCEL && !useSupabase) {
  throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required on Vercel (ephemeral disk)');
}

type Kind = 'resumes' | 'submissions' | 'posters';

/** Store an upload; returns the relative path ("<kind>/<random>.<ext>"). */
export async function saveUpload(kind: Kind, file: File): Promise<string> {
  const name = `${randomBytes(12).toString('hex')}${path.extname(file.name).toLowerCase()}`;
  const relPath = `${kind}/${name}`;
  const buf = Buffer.from(await file.arrayBuffer());
  if (useSupabase) {
    const res = await fetch(`${SUPA}/storage/v1/object/${kind}/${name}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SUPA_KEY}`,
        'content-type': file.type || 'application/octet-stream',
      },
      body: buf,
    });
    if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);
  } else {
    await mkdir(path.join(FILES_ROOT, kind), { recursive: true });
    await writeFile(path.join(FILES_ROOT, relPath), buf);
  }
  return relPath;
}

/** Fetch a stored file for serving. Null on traversal attempts or missing files. */
export async function getFile(
  parts: string[]
): Promise<{ body: ReadableStream; size?: number } | null> {
  const relPath = parts.join('/');
  if (parts.some((p) => p === '..' || p === '' || p.includes('\\'))) return null;
  if (useSupabase) {
    const res = await fetch(`${SUPA}/storage/v1/object/${relPath}`, {
      headers: { authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok || !res.body) return null;
    const len = Number(res.headers.get('content-length'));
    return { body: res.body, size: Number.isFinite(len) && len > 0 ? len : undefined };
  }
  const abs = path.resolve(FILES_ROOT, ...parts);
  if (!abs.startsWith(FILES_ROOT + path.sep)) return null;
  try {
    const info = await stat(abs);
    return { body: Readable.toWeb(createReadStream(abs)) as ReadableStream, size: info.size };
  } catch {
    return null;
  }
}

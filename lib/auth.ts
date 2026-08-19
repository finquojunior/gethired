import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { q } from '@/lib/db';

// Cookie-session auth with scrypt password hashes. Sessions are
// `userId.expiry.hmac` signed with SESSION_SECRET; every page/action verifies
// server-side via currentUser() — middleware is only a fast-path convenience,
// never the security boundary.

const SECRET = process.env.SESSION_SECRET ?? 'dev-secret-do-not-deploy';
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

export const SESSION_COOKIE = 'gh_session';
const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  name: string;
  role: 'admin' | 'hr' | 'dept_head' | 'interviewer';
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('hex');

export async function createSession(userId: string): Promise<void> {
  const expiry = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${userId}.${expiry}`;
  (await cookies()).set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Parse + verify the session cookie; returns the user id or null. */
export function verifySessionValue(value: string | undefined): string | null {
  if (!value) return null;
  const [userId, expiry, sig] = value.split('.');
  if (!userId || !expiry || !sig) return null;
  const expected = sign(`${userId}.${expiry}`);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  if (Number(expiry) < Date.now()) return null;
  return userId;
}

export async function currentUserOrNull(): Promise<SessionUser | null> {
  const userId = verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const {
    rows: [p],
  } = await q<{ id: string; full_name: string; role: SessionUser['role'] }>(
    `select id, full_name, role from public.profiles where id = $1`,
    [userId]
  );
  return p ? { id: p.id, name: p.full_name, role: p.role } : null;
}

/** The staff gate: unauthenticated requests are sent to /login. */
export async function currentUser(): Promise<SessionUser> {
  const user = await currentUserOrNull();
  if (!user) redirect('/login');
  return user;
}

export function isStaff(u: SessionUser): boolean {
  return u.role === 'admin' || u.role === 'hr';
}

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

// Direct-to-storage uploads: the path we minted for a candidate is signed so
// the submit request can't point at someone else's stored file.
export function signUploadPath(applicationId: number, relPath: string): string {
  return sign(`upload:${applicationId}:${relPath}`);
}

export function verifyUploadPath(applicationId: number, relPath: string, sig: string): boolean {
  const expected = Buffer.from(signUploadPath(applicationId, relPath));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

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

// --- authorization -----------------------------------------------------------
// Two tiers. Global staff (admin, hr) can do everything. Everyone else works
// inside the openings they belong to — a row in opening_members, or an
// interview slot they're on — and inside such an opening they can do
// everything. Admin-only: people management, settings, deleting opening data.

export async function requireStaff(): Promise<SessionUser> {
  const user = await currentUser();
  if (!isStaff(user)) forbidden();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await currentUser();
  if (user.role !== 'admin') forbidden();
  return user;
}

/** Bounce a signed-in user who lacks permission back to the dashboard with a flash. */
export function forbidden(): never {
  redirect('/app?e=forbidden');
}

/**
 * Opening ids this user may work in; null means all (global staff). Membership
 * of an opening, an interview slot on it, or an assigned department (which
 * covers every current and future opening in that department).
 */
export async function openingScope(u: SessionUser): Promise<number[] | null> {
  if (isStaff(u)) return null;
  const { rows } = await q<{ id: number }>(
    `select opening_id as id from public.opening_members where user_id = $1
     union
     select opening_id from public.slots where interviewer_id = $1 or $1 = any(panel)
     union
     select o.id from public.openings o
       join public.departments d on d.name = o.department
       join public.user_departments ud on ud.department_id = d.id and ud.user_id = $1`,
    [u.id]
  );
  return rows.map((r) => Number(r.id));
}

/** SQL fragment for list pages: `$n` is the bigint[] from openingScope (null = no filter). */
export const scopeSql = (col: string, n: number) => `($${n}::bigint[] is null or ${col} = any($${n}))`;

export async function canAccessOpening(u: SessionUser, openingId: number): Promise<boolean> {
  if (isStaff(u)) return true;
  if (!Number.isInteger(openingId)) return false;
  const { rows } = await q(
    `select 1 from public.opening_members where opening_id = $1 and user_id = $2
     union all
     select 1 from public.slots where opening_id = $1 and (interviewer_id = $2 or $2 = any(panel))
     union all
     select 1 from public.openings o
       join public.departments d on d.name = o.department
       join public.user_departments ud on ud.department_id = d.id
       where o.id = $1 and ud.user_id = $2
     limit 1`,
    [openingId, u.id]
  );
  return rows.length > 0;
}

/** Department names this user may create openings in; null means any (global staff). */
export async function departmentScope(u: SessionUser): Promise<string[] | null> {
  if (isStaff(u)) return null;
  const { rows } = await q<{ name: string }>(
    `select d.name from public.user_departments ud join public.departments d on d.id = ud.department_id
     where ud.user_id = $1 order by d.name`,
    [u.id]
  );
  return rows.map((r) => r.name);
}

/** May this user create or move an opening into `department`? Staff: any listed department. */
export async function canUseDepartment(u: SessionUser, department: string): Promise<boolean> {
  if (isStaff(u)) return true;
  const mine = await departmentScope(u);
  return mine !== null && mine.includes(department);
}

/** Action gate for one opening. */
export async function requireOpeningAccess(openingId: number): Promise<SessionUser> {
  const user = await currentUser();
  if (!(await canAccessOpening(user, openingId))) forbidden();
  return user;
}

/** Action gate for one application; also returns its opening for revalidation. */
export async function requireApplicationAccess(
  applicationId: number
): Promise<{ user: SessionUser; openingId: number }> {
  const user = await currentUser();
  const {
    rows: [a],
  } = await q<{ opening_id: number }>(`select opening_id from public.applications where id = $1`, [
    applicationId,
  ]);
  if (!a || !(await canAccessOpening(user, Number(a.opening_id)))) forbidden();
  return { user, openingId: Number(a.opening_id) };
}

/** Which opening a stored file belongs to (for scoped downloads); null if unknown. */
export async function openingIdForFile(relPath: string): Promise<number | null> {
  const {
    rows: [r],
  } = await q<{ id: number }>(
    `select opening_id as id from public.applications where resume_path = $1
     union all
     select a.opening_id from public.submissions su join public.applications a on a.id = su.application_id
       where su.file_path = $1
     union all
     select opening_id from public.stages where brief_file_path = $1
     limit 1`,
    [relPath]
  );
  return r ? Number(r.id) : null;
}

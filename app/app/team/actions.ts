'use server';

import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import { currentUser, hashPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';

const ROLES = ['admin', 'hr', 'dept_head', 'interviewer'];

async function requireAdmin() {
  const user = await currentUser();
  if (user.role !== 'admin') throw new Error('Admins only');
  return user;
}

export async function addUser(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get('name') ?? '').trim().slice(0, 200);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ROLES.includes(role)) return;
  if (password && password.length < 8) return;
  const {
    rows: [u],
  } = await q<{ id: string }>(
    `insert into auth.users (email) values ($1) on conflict (email) do update set email = excluded.email
     returning id`,
    [email]
  );
  await q(
    `insert into public.profiles (id, full_name, role, password_hash)
     values ($1, $2, $3, $4)
     on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
       password_hash = case when excluded.password_hash <> '' then excluded.password_hash
                            else public.profiles.password_hash end`,
    [u.id, name, role, password ? hashPassword(password) : '']
  );
  await audit(admin.id, 'add_user', 'profile', u.id, { email, role });
  revalidatePath('/app/team');
}

export async function setUserRole(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId'));
  const role = String(formData.get('role') ?? '');
  if (!ROLES.includes(role) || userId === admin.id) return;
  await q(`update public.profiles set role = $2 where id = $1`, [userId, role]);
  await audit(admin.id, 'set_role', 'profile', userId, { role });
  revalidatePath('/app/team');
}

export async function removeUser(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId'));
  if (userId === admin.id) return;
  await q(`delete from auth.users where id = $1`, [userId]); // cascades to profile
  await audit(admin.id, 'remove_user', 'profile', userId);
  revalidatePath('/app/team');
}

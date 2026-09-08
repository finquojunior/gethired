'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { q, tx } from '@/lib/db';
import { hashPassword, requireAdmin, requireStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';

const ROLES = ['admin', 'hr', 'dept_head', 'interviewer'];
const back = (ok?: string, e?: string) => redirect(`/app/team?${ok ? `ok=${ok}` : `e=${e}`}`);

const ids = (formData: FormData, key: string) => formData.getAll(key).map(Number).filter(Number.isInteger);

async function setDepartments(userId: string, departmentIds: number[]) {
  await tx(async (c) => {
    await c.query(`delete from public.user_departments where user_id = $1`, [userId]);
    if (departmentIds.length) {
      await c.query(
        `insert into public.user_departments (user_id, department_id)
         select $1, unnest($2::bigint[]) on conflict do nothing`,
        [userId, departmentIds]
      );
    }
  });
}

async function addOpenings(userId: string, openingIds: number[]) {
  if (openingIds.length === 0) return;
  const {
    rows: [p],
  } = await q<{ role: string }>(`select role from public.profiles where id = $1`, [userId]);
  await q(
    `insert into public.opening_members (opening_id, user_id, member_role)
     select unnest($2::bigint[]), $1, $3 on conflict do nothing`,
    [userId, openingIds, p?.role === 'interviewer' ? 'interviewer' : 'requester']
  );
}

/** Admin creates (or updates) an account and assigns departments + openings in one go. */
export async function addUser(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get('name') ?? '').trim().slice(0, 200);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ROLES.includes(role)) back(undefined, 'invalid');
  if (password && password.length < 8) back(undefined, 'password');
  // hosted Supabase's auth.users has no plain unique(email) constraint,
  // so upsert-by-email must be a lookup-then-insert
  let {
    rows: [u],
  } = await q<{ id: string }>(`select id from auth.users where email = $1`, [email]);
  const existed = Boolean(u);
  if (!u) {
    ({
      rows: [u],
    } = await q<{ id: string }>(
      `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
      [email]
    ));
  }
  await q(
    `insert into public.profiles (id, full_name, role, password_hash)
     values ($1, $2, $3, $4)
     on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
       password_hash = case when excluded.password_hash <> '' then excluded.password_hash
                            else public.profiles.password_hash end`,
    [u.id, name, role, password ? hashPassword(password) : '']
  );
  const departmentIds = ids(formData, 'departmentIds');
  const openingIds = ids(formData, 'openingIds');
  if (departmentIds.length) await setDepartments(u.id, departmentIds);
  await addOpenings(u.id, openingIds);
  await audit(admin.id, existed ? 'update_user' : 'add_user', 'profile', u.id, { email, role, departmentIds, openingIds });
  revalidatePath('/app/team');
  back(existed ? 'updated' : 'added');
}

export async function setUserRole(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId'));
  const role = String(formData.get('role') ?? '');
  if (!ROLES.includes(role) || userId === admin.id) back(undefined, 'invalid');
  await q(`update public.profiles set role = $2 where id = $1`, [userId, role]);
  await audit(admin.id, 'set_role', 'profile', userId, { role });
  revalidatePath('/app/team');
  back('role');
}

export async function removeUser(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId'));
  if (userId === admin.id) back(undefined, 'invalid');
  await q(`delete from auth.users where id = $1`, [userId]); // cascades to profile, memberships
  await audit(admin.id, 'remove_user', 'profile', userId);
  revalidatePath('/app/team');
  back('removed');
}

/** Replace a person's department set (checkboxes). */
export async function setUserDepartments(formData: FormData) {
  const staff = await requireStaff();
  const userId = String(formData.get('userId'));
  const departmentIds = ids(formData, 'departmentIds');
  await setDepartments(userId, departmentIds);
  await audit(staff.id, 'set_departments', 'profile', userId, { departmentIds });
  revalidatePath('/app/team');
  back('departments');
}

export async function addUserOpening(formData: FormData) {
  const staff = await requireStaff();
  const userId = String(formData.get('userId'));
  const openingId = Number(formData.get('openingId'));
  if (!Number.isInteger(openingId)) back(undefined, 'invalid');
  await addOpenings(userId, [openingId]);
  await audit(staff.id, 'add_member', 'opening', openingId, { memberId: userId });
  revalidatePath('/app/team');
  revalidatePath(`/app/openings/${openingId}/team`);
  back('opening');
}

export async function removeUserOpening(formData: FormData) {
  const staff = await requireStaff();
  const userId = String(formData.get('userId'));
  const openingId = Number(formData.get('openingId'));
  await q(`delete from public.opening_members where opening_id = $1 and user_id = $2`, [openingId, userId]);
  await audit(staff.id, 'remove_member', 'opening', openingId, { memberId: userId });
  revalidatePath('/app/team');
  revalidatePath(`/app/openings/${openingId}/team`);
  back('opening_removed');
}

// --- departments list ---

export async function addDepartment(formData: FormData) {
  const staff = await requireStaff();
  const name = String(formData.get('name') ?? '').trim().slice(0, 80);
  if (!name) back(undefined, 'invalid');
  await q(`insert into public.departments (name) values ($1) on conflict (name) do nothing`, [name]);
  await audit(staff.id, 'add_department', 'department', name);
  revalidatePath('/app/team');
  back('department_added');
}

/** Rename a department everywhere: the list and every opening that carries the old name. */
export async function renameDepartment(formData: FormData) {
  const staff = await requireStaff();
  const id = Number(formData.get('departmentId'));
  const name = String(formData.get('name') ?? '').trim().slice(0, 80);
  if (!name || !Number.isInteger(id)) back(undefined, 'invalid');
  try {
    await tx(async (c) => {
      const {
        rows: [old],
      } = await c.query<{ name: string }>(`select name from public.departments where id = $1 for update`, [id]);
      if (!old || old.name === name) return;
      await c.query(`update public.departments set name = $2 where id = $1`, [id, name]);
      await c.query(`update public.openings set department = $2 where department = $1`, [old.name, name]);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') back(undefined, 'duplicate');
    throw e;
  }
  await audit(staff.id, 'rename_department', 'department', id, { name });
  revalidatePath('/app/team');
  revalidatePath('/app/openings');
  back('department_renamed');
}

/** Remove a department from the list; openings keep their text label, people lose that access. */
export async function deleteDepartment(formData: FormData) {
  const staff = await requireStaff();
  const id = Number(formData.get('departmentId'));
  await q(`delete from public.departments where id = $1`, [id]);
  await audit(staff.id, 'delete_department', 'department', id);
  revalidatePath('/app/team');
  back('department_removed');
}

'use server';

import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import { currentUser, isStaff } from '@/lib/auth';
import { runCronWork } from '@/lib/cron-work';

async function requireStaff() {
  const user = await currentUser();
  if (!isStaff(user)) throw new Error('Not allowed');
  return user;
}

export async function processOutbox() {
  await requireStaff();
  await runCronWork();
  revalidatePath('/app/emails');
}

export async function cancelEmail(formData: FormData) {
  await requireStaff();
  await q(`update public.email_log set status = 'cancelled' where id = $1 and status = 'pending'`, [
    Number(formData.get('emailId')),
  ]);
  revalidatePath('/app/emails');
}

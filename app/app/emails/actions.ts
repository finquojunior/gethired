'use server';

import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import { currentUser, isStaff } from '@/lib/auth';
import { runCronWork } from '@/lib/cron-work';
import { attemptSend } from '@/lib/email';

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
  await q(
    `update public.email_log set status = 'cancelled' where id = $1 and status in ('draft', 'pending')`,
    [Number(formData.get('emailId'))]
  );
  revalidatePath('/app/emails');
}

/** Deliver a drafted email (e.g. a rejection queued as "Reject + draft email"). */
export async function sendDraft(formData: FormData) {
  await requireStaff();
  const id = Number(formData.get('emailId'));
  const { rowCount } = await q(
    `update public.email_log set status = 'pending' where id = $1 and status = 'draft'`,
    [id]
  );
  if (rowCount) await attemptSend(id);
  revalidatePath('/app/emails');
}

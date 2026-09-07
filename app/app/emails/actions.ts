'use server';

import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import { requireApplicationAccess, requireStaff } from '@/lib/auth';
import { runCronWork } from '@/lib/cron-work';
import { attemptSend } from '@/lib/email';

/** Gate an outbox row through the opening its application belongs to. */
async function requireEmailAccess(emailId: number) {
  const {
    rows: [e],
  } = await q<{ application_id: number }>(`select application_id from public.email_log where id = $1`, [emailId]);
  if (!e) return null;
  await requireApplicationAccess(Number(e.application_id));
  return emailId;
}

export async function processOutbox() {
  await requireStaff();
  await runCronWork();
  revalidatePath('/app/emails');
}

export async function cancelEmail(formData: FormData) {
  const id = await requireEmailAccess(Number(formData.get('emailId')));
  if (!id) return;
  await q(
    `update public.email_log set status = 'cancelled' where id = $1 and status in ('draft', 'pending')`,
    [id]
  );
  revalidatePath('/app/emails');
}

/** Manual resend of a failed email with an explicitly chosen service. */
export async function resendFailedEmail(formData: FormData) {
  const id = await requireEmailAccess(Number(formData.get('emailId')));
  if (!id) return;
  const service = String(formData.get('service'));
  if (service !== 'resend' && service !== 'gmail') return;
  await attemptSend(id, service);
  revalidatePath('/app/emails');
}

/** Deliver a drafted email (e.g. a rejection queued as "Reject + draft email"). */
export async function sendDraft(formData: FormData) {
  const id = await requireEmailAccess(Number(formData.get('emailId')));
  if (!id) return;
  const { rowCount } = await q(
    `update public.email_log set status = 'pending' where id = $1 and status = 'draft'`,
    [id]
  );
  if (rowCount) await attemptSend(id);
  revalidatePath('/app/emails');
}

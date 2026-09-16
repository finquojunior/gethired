'use server';

import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { DEFAULT_TEMPLATES } from '@/lib/email';

export async function setMailService(formData: FormData) {
  const user = await requireStaff();
  const service = String(formData.get('service'));
  if (service !== 'resend' && service !== 'gmail') return;
  await q(
    `insert into public.app_settings (key, value) values ('mail_service', $1)
     on conflict (key) do update set value = excluded.value`,
    [service]
  );
  await audit(user.id, 'set_mail_service', 'app_settings', 'mail_service', { service });
  revalidatePath('/app/settings');
}

export async function saveTemplate(formData: FormData) {
  const user = await requireStaff();
  const key = String(formData.get('key'));
  if (!DEFAULT_TEMPLATES[key]) return;
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!subject && !body) {
    // empty save = revert to the built-in default
    await q('delete from public.email_templates where key = $1', [key]);
  } else {
    await q(
      `insert into public.email_templates (key, subject, body) values ($1, $2, $3)
       on conflict (key) do update set subject = excluded.subject, body = excluded.body`,
      [key, subject || DEFAULT_TEMPLATES[key].subject, body || DEFAULT_TEMPLATES[key].body]
    );
  }
  await audit(user.id, 'edit_template', 'email_template', key);
  revalidatePath('/app/settings');
}

export async function setResendLimits(formData: FormData) {
  const user = await requireStaff();
  const day = Math.floor(Number(formData.get('day')));
  const month = Math.floor(Number(formData.get('month')));
  if (!(day >= 1 && day <= 1_000_000 && month >= 1 && month <= 1_000_000)) return;
  await q(
    `insert into public.app_settings (key, value) values
       ('resend_daily_limit', $1), ('resend_monthly_limit', $2)
     on conflict (key) do update set value = excluded.value`,
    [String(day), String(month)]
  );
  await audit(user.id, 'set_resend_limits', 'app_settings', 'resend_limits', { day, month });
  revalidatePath('/app/settings');
}

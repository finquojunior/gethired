'use server';

import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import { currentUser, isStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { DEFAULT_TEMPLATES } from '@/lib/email';

export async function saveTemplate(formData: FormData) {
  const user = await currentUser();
  if (!isStaff(user)) throw new Error('Not allowed');
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

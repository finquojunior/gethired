import { q } from '@/lib/db';

// Outbox email: every send is a row in email_log first (status pending),
// then delivered — immediately for normal sends, or by the cron for delayed
// ones. Subject/body come from email_templates (staff-editable) with the
// defaults below as fallback. {{var}} placeholders are substituted.

if (process.env.NODE_ENV === 'production') {
  if (!process.env.APP_URL) throw new Error('APP_URL is required in production');
  if (process.env.RESEND_API_KEY && !process.env.EMAIL_FROM) {
    throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set');
  }
}

const FROM = process.env.EMAIL_FROM ?? 'Hiring <hiring@example.com>';

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; vars: string[] }> = {
  application_received: {
    subject: 'Application received — {{role}}',
    body: `Hi {{name}},\n\nThanks for applying for {{role}}. We've received your application and will be in touch.\n\nTrack your application status any time:\n{{portal_link}}\n`,
    vars: ['name', 'role', 'portal_link'],
  },
  interview_invite: {
    subject: 'Interview round — {{role}}',
    body: `Hi {{name}},\n\nGood news — you're moving to the interview round for {{role}}.\n\nPick an interview slot that works for you here:\n{{portal_link}}\n\nSee you soon!`,
    vars: ['name', 'role', 'portal_link'],
  },
  task_assigned: {
    subject: 'Your task for {{role}}',
    body: `Hi {{name}},\n\nYou've progressed to the task round for {{role}}.\n\n{{brief}}\n\nSubmit your work here:\n{{portal_link}}\n`,
    vars: ['name', 'role', 'brief', 'portal_link'],
  },
  booking_confirmation: {
    subject: 'Interview confirmed — {{role}}',
    body: `Hi {{name}},\n\nYour interview for {{role}} is confirmed:\n\n{{when}} ({{duration}} minutes) with {{interviewer}}.\n{{link}}\n\nNeed to change it? Use your status page up to 24 hours before.\n`,
    vars: ['name', 'role', 'when', 'duration', 'interviewer', 'link'],
  },
  interview_reminder: {
    subject: 'Reminder: your interview tomorrow — {{role}}',
    body: `Hi {{name}},\n\nA reminder about your interview for {{role}}:\n\n{{when}} ({{duration}} minutes) with {{interviewer}}.\n{{link}}\n\nGood luck!\n`,
    vars: ['name', 'role', 'when', 'duration', 'interviewer', 'link'],
  },
  stage_update: {
    subject: 'Application update — {{role}}',
    body: `Hi {{name}},\n\nGood news — your application for {{role}} has moved forward to the {{stage}} stage.\n\nTrack your application any time:\n{{portal_link}}\n`,
    vars: ['name', 'role', 'stage', 'portal_link'],
  },
  hired: {
    subject: 'Congratulations — {{role}}!',
    body: `Hi {{name}},\n\nCongratulations! We're delighted to let you know you've been selected for {{role}}.\n\nOur team will reach out shortly with the next steps and your offer details.\n\nWelcome aboard!`,
    vars: ['name', 'role'],
  },
  rejection: {
    subject: 'Update on your application — {{role}}',
    body: `Hi {{name}},\n\nThank you for applying for {{role}}. After careful review we won't be moving forward with your application this time.\n\nWe'd love to see you apply again for future roles.\n`,
    vars: ['name', 'role'],
  },
  interviewer_booked: {
    subject: 'Interview booked: {{name}} — {{role}}',
    body: `{{name}} booked an interview with you for {{role}}:\n\n{{when}} ({{duration}} minutes).\n\nCandidate profile: {{profile_link}}\n`,
    vars: ['name', 'role', 'when', 'duration', 'profile_link'],
  },
  interviewer_cancelled: {
    subject: 'Interview cancelled: {{name}} — {{role}}',
    body: `The interview with {{name}} for {{role}} on {{when}} was cancelled and the slot has been freed.\n`,
    vars: ['name', 'role', 'when'],
  },
  feedback_nudge: {
    subject: 'Feedback pending: {{name}} — {{role}}',
    body: `Your interview with {{name}} for {{role}} has ended, and no feedback has been recorded yet.\n\nAdd your verdict here: {{profile_link}}\n`,
    vars: ['name', 'role', 'profile_link'],
  },
};

function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export async function sendEmail(input: {
  applicationId: number;
  template: keyof typeof DEFAULT_TEMPLATES | string;
  to: string;
  vars: Record<string, string>;
  ics?: string;
  /** Log the email as a draft; staff send it manually from the Emails tab. */
  draft?: boolean;
}): Promise<void> {
  if (!input.to) return;
  const fallback = DEFAULT_TEMPLATES[input.template];
  const {
    rows: [override],
  } = await q<{ subject: string; body: string }>(
    'select subject, body from public.email_templates where key = $1',
    [input.template]
  );
  const tpl = override ?? fallback;
  if (!tpl) throw new Error(`unknown email template: ${input.template}`);

  const {
    rows: [row],
  } = await q<{ id: number }>(
    `insert into public.email_log (application_id, template, to_email, subject, body, ics, status)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      input.applicationId,
      input.template,
      input.to,
      render(tpl.subject, input.vars),
      render(tpl.body, input.vars),
      input.ics ?? '',
      input.draft ? 'draft' : 'pending',
    ]
  );
  if (!input.draft) await attemptSend(row.id);
}

/** Deliver one outbox row. Used inline and by the cron retry loop. */
export async function attemptSend(id: number): Promise<void> {
  const {
    rows: [row],
  } = await q<{ to_email: string; subject: string; body: string; ics: string; attempts: number }>(
    `select to_email, subject, body, ics, attempts from public.email_log
     where id = $1 and status in ('pending', 'failed')`,
    [id]
  );
  if (!row) return;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      // never silently swallow candidate email in production
      await q(
        `update public.email_log set status = 'failed', attempts = attempts + 1,
           error = 'RESEND_API_KEY is not set in this environment' where id = $1`,
        [id]
      );
      return;
    }
    // dev: the log row IS the outbox; mark delivered
    await q(`update public.email_log set status = 'sent', sent_at = now() where id = $1`, [id]);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [row.to_email],
        subject: row.subject,
        text: row.body,
        attachments: row.ics
          ? [{ filename: 'interview.ics', content: Buffer.from(row.ics).toString('base64') }]
          : undefined,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    await q(`update public.email_log set status = 'sent', sent_at = now() where id = $1`, [id]);
  } catch (e) {
    await q(
      `update public.email_log set status = 'failed', attempts = attempts + 1, error = $2 where id = $1`,
      [id, String(e).slice(0, 1000)]
    );
  }
}

/** One-off compose from a candidate profile: logged in the outbox like everything else. */
export async function sendCustomEmail(
  applicationId: number,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const {
    rows: [row],
  } = await q<{ id: number }>(
    `insert into public.email_log (application_id, template, to_email, subject, body, status)
     values ($1, 'custom', $2, $3, $4, 'pending') returning id`,
    [applicationId, to, subject, body]
  );
  await attemptSend(row.id);
}

export function portalUrl(token: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/c/${token}`;
}

export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}${path}`;
}

export function icsEvent(opts: {
  title: string;
  startsAt: Date;
  durationMins: number;
  description?: string;
}): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(opts.startsAt.getTime() + opts.durationMins * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//gethired//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@gethired`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(opts.startsAt)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${opts.title}`,
    opts.description ? `DESCRIPTION:${opts.description.replace(/\n/g, '\\n')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

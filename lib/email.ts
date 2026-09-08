import { q } from '@/lib/db';
import { sendPlan, type MailService } from '@/lib/mailplan';
import { DEFAULT_TEMPLATES } from '@/lib/email-templates';
export { DEFAULT_TEMPLATES };

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

export const ORG_NAME = process.env.ORG_NAME ?? 'Finquo Junior';
/** Where candidates write back: SUPPORT_EMAIL, else the address in EMAIL_FROM. */
export const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL ??
  /[^\s<>"]+@[^\s<>"]+/.exec(process.env.EMAIL_FROM ?? '')?.[0] ??
  'hiring@finquojunior.com';

for (const t of Object.values(DEFAULT_TEMPLATES)) t.vars.push('org', 'support_email');

function render(text: string, vars: Record<string, string>): string {
  const all: Record<string, string> = { org: ORG_NAME, support_email: SUPPORT_EMAIL, careers_link: appUrl('/careers'), ...vars };
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => all[k] ?? '');
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

// --- delivery services: Resend (API) and Gmail SMTP (app password) ---

export function mailConfigured(): Record<MailService, boolean> {
  return {
    resend: Boolean(process.env.RESEND_API_KEY),
    gmail: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
  };
}

/** The staff-selected primary service (Settings tab); Resend by default. */
export async function getMailService(): Promise<MailService> {
  const {
    rows: [row],
  } = await q<{ value: string }>(`select value from public.app_settings where key = 'mail_service'`);
  return row?.value === 'gmail' ? 'gmail' : 'resend';
}

let gmailTransport: import('nodemailer').Transporter | undefined;

async function deliver(
  service: MailService,
  row: { to_email: string; subject: string; body: string; ics: string }
): Promise<void> {
  if (service === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
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
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  if (!gmailTransport) {
    const nodemailer = await import('nodemailer');
    gmailTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  await gmailTransport.sendMail({
    from: FROM, // must be the Workspace account or one of its "Send mail as" aliases
    to: row.to_email,
    subject: row.subject,
    text: row.body,
    attachments: row.ics
      ? [{ filename: 'interview.ics', content: row.ics, contentType: 'text/calendar' }]
      : undefined,
  });
}

/**
 * Deliver one outbox row. Without `force`: one burst — primary service, primary
 * again, then the other service (recorded as fallback). With `force` (manual
 * resend from the Emails tab): a single attempt with that exact service.
 */
export async function attemptSend(id: number, force?: MailService): Promise<void> {
  const {
    rows: [row],
  } = await q<{ to_email: string; subject: string; body: string; ics: string }>(
    `select to_email, subject, body, ics from public.email_log
     where id = $1 and status in ('pending', 'failed')`,
    [id]
  );
  if (!row) return;

  const configured = mailConfigured();
  const primary = await getMailService();
  const plan = force ? (configured[force] ? [force] : []) : sendPlan(primary, configured);

  if (plan.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      // never silently swallow candidate email in production
      await q(
        `update public.email_log set status = 'failed', attempts = attempts + 1,
           error = 'no mail service configured (or the chosen one is missing credentials)' where id = $1`,
        [id]
      );
      return;
    }
    // dev: the log row IS the outbox; mark delivered
    await q(
      `update public.email_log set status = 'sent', sent_at = now(), service = 'dev (logged only)' where id = $1`,
      [id]
    );
    return;
  }

  let lastError = '';
  for (const [i, service] of plan.entries()) {
    try {
      await deliver(service, row);
      const label = !force && service !== primary ? `${service} (fallback)` : service;
      await q(
        `update public.email_log set status = 'sent', sent_at = now(), service = $2,
           attempts = attempts + $3, error = '' where id = $1`,
        [id, label, i + 1]
      );
      return;
    } catch (e) {
      lastError = String(e).slice(0, 1000);
    }
  }
  await q(
    `update public.email_log set status = 'failed', attempts = attempts + $2,
       error = $3, service = $4 where id = $1`,
    [id, plan.length, lastError, plan[plan.length - 1]]
  );
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
  url?: string;
  location?: string;
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
    opts.url ? `URL:${opts.url}` : '',
    opts.location ? `LOCATION:${opts.location.replace(/,/g, '\\,')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

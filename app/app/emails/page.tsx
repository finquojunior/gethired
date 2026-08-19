import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import { cancelEmail, processOutbox } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-pine-wash text-pine-deep',
  pending: 'bg-amber/15 text-amber',
  failed: 'bg-rust/10 text-rust',
  cancelled: 'bg-line text-ink-soft',
};

export default async function EmailsPage() {
  const { rows: emails } = await q<{
    id: number;
    template: string;
    to_email: string;
    subject: string;
    body: string;
    status: string;
    send_after: Date;
    error: string;
    created_at: Date;
    application_id: number;
    candidate: string;
  }>(
    `select e.id, e.template, e.to_email, e.subject, e.body, e.status, e.send_after,
            e.error, e.created_at, a.id as application_id, a.name as candidate
     from public.email_log e join public.applications a on a.id = e.application_id
     order by e.id desc limit 100`
  );

  return (
    <div>
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Emails</h1>
        <form action={processOutbox} className="pb-1">
          <SubmitButton className="btn-quiet" pendingLabel="Processing…">
            Process outbox now
          </SubmitButton>
        </form>
      </div>
      <p className="mt-4 text-sm text-ink-soft">
        Every email the system sends is logged here. Pending emails (like rejection emails in
        their undo window) go out automatically; failed ones retry up to 3 times.
        {!process.env.RESEND_API_KEY && ' No RESEND_API_KEY is set, so emails are logged but not delivered.'}
      </p>

      <ul className="mt-6 space-y-2">
        {emails.map((e) => (
          <li key={e.id} className="rounded-lg border border-line bg-card">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>
                  {e.status}
                </span>
                <span className="font-medium">{e.subject}</span>
                <span className="text-ink-soft">
                  to {e.to_email} · {e.template} · {fmtDateTime(e.created_at)}
                </span>
                {e.status === 'pending' && e.send_after > new Date() && (
                  <span className="text-xs text-amber">sends {fmtDateTime(e.send_after)}</span>
                )}
              </summary>
              <div className="border-t border-line px-4 py-3 text-sm">
                <p className="whitespace-pre-line">{e.body}</p>
                {e.error && <p className="mt-2 text-rust">error: {e.error}</p>}
                <div className="mt-3 flex gap-3">
                  <Link href={`/app/candidates/${e.application_id}`} className="text-pine underline">
                    {e.candidate}
                  </Link>
                  {e.status === 'pending' && (
                    <form action={cancelEmail}>
                      <input type="hidden" name="emailId" value={e.id} />
                      <SubmitButton className="text-rust underline" pendingLabel="…">
                        Cancel this email
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            </details>
          </li>
        ))}
        {emails.length === 0 && (
          <li className="rounded-lg border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            No emails yet.
          </li>
        )}
      </ul>
    </div>
  );
}

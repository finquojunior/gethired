import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, isStaff, openingScope, scopeSql } from '@/lib/auth';
import { fmtDateTime } from '@/lib/tz';
import { mailConfigured } from '@/lib/email';
import SubmitButton from '@/components/SubmitButton';
import { cancelEmail, processOutbox, resendFailedEmail, sendDraft } from './actions';
import LiveSearch from '@/components/LiveSearch';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Emails' };

const LIMIT = 100;

type BadgeStyle = { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string };
const AMBER: BadgeStyle = { variant: 'outline', className: 'border-transparent bg-amber/15 text-amber' };
const STATUS_BADGE: Record<string, BadgeStyle> = {
  draft: AMBER,
  sent: { variant: 'secondary' },
  pending: AMBER,
  failed: { variant: 'destructive' },
  cancelled: { variant: 'outline' },
};

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: query = '' } = await searchParams;
  const term = query.trim().slice(0, 100);
  const user = await currentUser();
  const scope = await openingScope(user);
  const { rows: emails } = await q<{
    id: number;
    template: string;
    to_email: string;
    subject: string;
    body: string;
    status: string;
    send_after: Date;
    service: string;
    error: string;
    created_at: Date;
    application_id: number;
    candidate: string;
  }>(
    `select e.id, e.template, e.to_email, e.subject, e.body, e.status, e.send_after,
            e.service, e.error, e.created_at, a.id as application_id, a.name as candidate
     from public.email_log e join public.applications a on a.id = e.application_id
     where ${scopeSql('a.opening_id', 3)}
       and ($1 = '' or e.subject ilike $2 or e.to_email ilike $2 or a.name ilike $2
        or e.template ilike $2 or e.status ilike $2 or e.body ilike $2)
     order by e.id desc limit ${LIMIT + 1}`,
    [term, `%${term}%`, scope]
  );
  const truncated = emails.length > LIMIT;
  if (truncated) emails.pop();
  const configured = mailConfigured();

  return (
    <div>
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Emails</h1>
        {isStaff(user) && (
        <form action={processOutbox} className="pb-1">
          <SubmitButton variant="outline" pendingLabel="Processing…" doneMessage="Outbox processed — statuses updated below">
            Process outbox now
          </SubmitButton>
        </form>
        )}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Every email the system sends is logged here. Drafts (from &quot;Reject + draft email&quot;)
        wait until you send them; failed sends retry up to 3 times.
        {!configured.resend && !configured.gmail &&
          ' Neither Resend nor Gmail is configured (RESEND_API_KEY, or GMAIL_USER + GMAIL_APP_PASSWORD), so emails are logged but not delivered.'}
      </p>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="q">Search emails</label>
        <LiveSearch
          id="q"
          name="q"
          defaultValue={term}
          placeholder="Search by candidate, email address, subject, template, or status…" className="min-w-48 flex-1" />
        {term && (
          <Link href="/app/emails" className={buttonVariants({ variant: 'outline' })}>
            Clear
          </Link>
        )}
      </form>

      <ul className="mt-6 space-y-2">
        {emails.map((e) => (
          <li key={e.id}>
            <details className="group">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm hover:bg-muted/40 group-open:rounded-b-none">
                <Badge variant={STATUS_BADGE[e.status]?.variant ?? 'outline'} className={STATUS_BADGE[e.status]?.className}>
                  {e.status}
                </Badge>
                {e.service && <Badge variant="outline">via {e.service}</Badge>}
                <span className="font-medium">{e.subject}</span>
                <span className="text-muted-foreground">
                  to {e.to_email} · {e.template} · {fmtDateTime(e.created_at)}
                </span>
                {e.status === 'pending' && e.send_after > new Date() && (
                  <span className="text-xs text-amber">sends {fmtDateTime(e.send_after)}</span>
                )}
              </summary>
              <div className="rounded-b-lg border border-t-0 bg-card px-4 py-3 text-sm">
                <p className="whitespace-pre-line">{e.body}</p>
                {e.error && <p className="mt-2 text-destructive">error: {e.error}</p>}
                <div className="mt-3 flex gap-3">
                  <Link href={`/app/candidates/${e.application_id}`} className="text-primary underline">
                    {e.candidate}
                  </Link>
                  {e.status === 'failed' && (
                    <form action={resendFailedEmail} className="flex gap-3">
                      <input type="hidden" name="emailId" value={e.id} />
                      <SubmitButton
                        name="service"
                        value="resend"
                        variant="link"
                        size="sm"
                        pendingLabel="Sending…"
                        doneMessage="Resend attempted — check the status"
                      >
                        Resend via Resend
                      </SubmitButton>
                      <SubmitButton
                        name="service"
                        value="gmail"
                        variant="link"
                        size="sm"
                        pendingLabel="Sending…"
                        doneMessage="Resend attempted — check the status"
                      >
                        Resend via Gmail
                      </SubmitButton>
                    </form>
                  )}
                  {e.status === 'draft' && (
                    <form action={sendDraft}>
                      <input type="hidden" name="emailId" value={e.id} />
                      <SubmitButton variant="link" size="sm" pendingLabel="Sending…" doneMessage="Draft sent">
                        Send now
                      </SubmitButton>
                    </form>
                  )}
                  {(e.status === 'pending' || e.status === 'draft') && (
                    <form action={cancelEmail}>
                      <input type="hidden" name="emailId" value={e.id} />
                      <SubmitButton variant="destructive" size="sm" pendingLabel="Cancelling…" doneMessage="Email cancelled" confirmText="Cancel this email? It will not be sent.">
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
          <li>
            <Empty className="border bg-card">
              <EmptyHeader>
                <EmptyTitle>{term ? `No emails match “${term}”.` : 'No emails yet.'}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </li>
        )}
        {truncated && (
          <li className="px-4 py-3 text-center text-xs text-muted-foreground">
            Showing the most recent {LIMIT} — search to narrow it down.
          </li>
        )}
      </ul>
    </div>
  );
}

import { q } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { DEFAULT_TEMPLATES, getMailService, getMailUsage, mailConfigured, resendExhausted } from '@/lib/email';
import { fmtDateTime, orgTimeToUtc } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import { saveTemplate, setMailService, setResendLimits } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

const AUDIT_LIMIT = 200;
const ERROR_LIMIT = 100;

const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const nextDay = (s: string) => new Date(Date.parse(`${s}T00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  // activity log date filter: one day set = that day only; both = inclusive range (org-local days)
  const sp = await searchParams;
  const from = isDay(sp.from) ? sp.from! : isDay(sp.to) ? sp.to! : '';
  const to = isDay(sp.to) ? sp.to! : from;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const filtered = !!lo;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  // ponytail: offset paging; fine at audit-log scale, switch to keyset on id if deep pages get slow
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (filtered) p.set('from', lo);
    if (filtered && hi !== lo) p.set('to', hi);
    if (n > 1) p.set('page', String(n));
    return `/app/settings${p.size ? `?${p}` : ''}#activity`;
  };
  const user = await requireStaff();
  const isAdmin = user.role === 'admin';
  const mailService = await getMailService();
  const configured = mailConfigured();
  const usage = await getMailUsage();
  const overQuota = resendExhausted(usage);
  // Resend's counters reset at UTC midnight / the 1st (UTC); shown in org time
  const now = new Date();
  const dayReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const monthReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const { rows: overrides } = await q<{ key: string; subject: string; body: string }>(
    'select key, subject, body from public.email_templates'
  );
  const byKey = new Map(overrides.map((o) => [o.key, o]));

  // logs are admin-only (also enforced by RLS once real auth lands)
  const { rows: auditRows } = isAdmin
    ? await q<{
        action: string;
        entity: string;
        entity_id: string;
        detail: Record<string, unknown>;
        actor: string | null;
        actor_id: string | null;
        created_at: Date;
      }>(
        `select l.action, l.entity, l.entity_id, l.detail, l.actor_id, p.full_name as actor, l.created_at
         from public.audit_log l left join public.profiles p on p.id = l.actor_id
         ${filtered ? 'where l.created_at >= $1 and l.created_at < $2' : ''}
         order by l.id desc limit ${AUDIT_LIMIT + 1} offset ${(page - 1) * AUDIT_LIMIT}`,
        filtered ? [orgTimeToUtc(lo, '00:00'), orgTimeToUtc(nextDay(hi), '00:00')] : undefined
      )
    : { rows: [] };
  const moreAudit = auditRows.length > AUDIT_LIMIT;
  if (moreAudit) auditRows.pop();

  const { rows: errorRows } = isAdmin
    ? await q<{
        id: number;
        source: string;
        message: string;
        stack: string;
        context: Record<string, unknown>;
        created_at: Date;
      }>(
        `select id, source, message, stack, context, created_at
         from public.error_log order by id desc limit ${ERROR_LIMIT + 1}`
      )
    : { rows: [] };
  const moreErrors = errorRows.length > ERROR_LIMIT;
  if (moreErrors) errorRows.pop();

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Settings</h1>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Mail service</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Which service sends candidate emails. If a send fails twice on the selected service, the
          system automatically falls back to the other one. When Resend reaches its daily or monthly
          limit, everything goes through Gmail until the limit resets.
        </p>
        <form action={setMailService} className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="service" value="resend" defaultChecked={mailService === 'resend'}  />
            Resend
            <span className={`text-xs ${configured.resend ? 'text-primary' : 'text-destructive'}`}>
              {configured.resend ? 'configured' : 'not configured — set RESEND_API_KEY'}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="service" value="gmail" defaultChecked={mailService === 'gmail'}  />
            Gmail (Workspace SMTP)
            <span className={`text-xs ${configured.gmail ? 'text-primary' : 'text-destructive'}`}>
              {configured.gmail ? 'configured' : 'not configured — set GMAIL_USER + GMAIL_APP_PASSWORD'}
            </span>
          </label>
          <SubmitButton pendingLabel="Saving…" doneMessage="Mail service updated">
            Save
          </SubmitButton>
        </form>

        <h3 className="mt-6 text-sm font-semibold">Emails sent</h3>
        {overQuota && (
          <p className="mt-2">
            <Badge variant="destructive">Resend limit reached — sending via Gmail until reset</Badge>
          </p>
        )}
        <table className="mt-2 w-full max-w-md text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Service</th>
              <th className="py-1 font-medium">Today</th>
              <th className="py-1 font-medium">This month</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="py-1">Resend</td>
              <td className={`py-1 tabular-nums ${usage.resend.day >= usage.limits.day ? 'text-destructive' : ''}`}>
                {usage.resend.day} / {usage.limits.day}
              </td>
              <td className={`py-1 tabular-nums ${usage.resend.month >= usage.limits.month ? 'text-destructive' : ''}`}>
                {usage.resend.month} / {usage.limits.month}
              </td>
            </tr>
            <tr className="border-t">
              <td className="py-1">Gmail</td>
              <td className="py-1 tabular-nums">{usage.gmail.day}</td>
              <td className="py-1 tabular-nums">{usage.gmail.month}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Counted per UTC day and month, matching Resend. Day resets {fmtDateTime(dayReset)}; month resets{' '}
          {fmtDateTime(monthReset)}.
        </p>
        <form action={setResendLimits} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Resend daily limit</span>
            <Input type="number" name="day" min={1} defaultValue={usage.limits.day} className="mt-1 w-28" required />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Resend monthly limit</span>
            <Input type="number" name="month" min={1} defaultValue={usage.limits.month} className="mt-1 w-28" required />
          </label>
          <SubmitButton pendingLabel="Saving…" doneMessage="Resend limits updated">
            Save limits
          </SubmitButton>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Email templates</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Placeholders like {'{{name}}'} are filled automatically. Clear both fields and save to
          revert a template to its default.
        </p>
        <div className="mt-4 space-y-3">
          {Object.entries(DEFAULT_TEMPLATES).map(([key, def]) => {
            const o = byKey.get(key);
            return (
              <details key={key} className="group">
                <summary className="cursor-pointer rounded-lg border bg-card px-4 py-3 text-sm font-medium hover:bg-muted/40 group-open:rounded-b-none">
                  {key}
                  {o && <Badge variant="secondary" className="ml-2">customized</Badge>}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    vars: {def.vars.map((v) => `{{${v}}}`).join(' ')}
                  </span>
                </summary>
                <form action={saveTemplate} className="space-y-2 rounded-b-lg border border-t-0 bg-card px-4 pt-3 pb-4">
                  <input type="hidden" name="key" value={key} />
                  <Input
                    name="subject"
                    defaultValue={o?.subject ?? def.subject}
                    aria-label="Subject" />
                  <Textarea
                    name="body"
                    rows={6}
                    defaultValue={o?.body ?? def.body} className="font-mono text-xs"
                    aria-label="Body" />
                  <SubmitButton pendingLabel="Saving…" doneMessage="Template saved">Save template</SubmitButton>
                </form>
              </details>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Data retention</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Candidate PII accumulates indefinitely by default. To remove it, download an opening&apos;s
          archive and then delete its data from the Danger zone on the opening page (admins only).
          Per-candidate anonymisation is not available yet.
        </p>
      </section>

      {isAdmin && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">Errors</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Every error anyone hits — staff, candidates, server or browser — is recorded here
            automatically. Admins only.
          </p>
          <ul className="mt-4 space-y-2">
            {errorRows.map((e) => (
              <li key={e.id}>
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm hover:bg-muted/40 group-open:rounded-b-none">
                    <Badge variant="destructive">{e.source}</Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.message}</span>
                    <span className="text-muted-foreground">{fmtDateTime(e.created_at)}</span>
                  </summary>
                  <div className="rounded-b-lg border border-t-0 bg-card px-4 py-3 text-xs">
                    {Object.keys(e.context).length > 0 && (
                      <p className="mb-2 text-muted-foreground">
                        {Object.entries(e.context)
                          .filter(([, v]) => v !== '' && v != null)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ')}
                      </p>
                    )}
                    {e.stack && (
                      <pre className="overflow-x-auto rounded-lg bg-muted p-2 font-mono">{e.stack}</pre>
                    )}
                  </div>
                </details>
              </li>
            ))}
            {errorRows.length === 0 && (
              <li>
                <Empty className="border bg-card">
                  <EmptyHeader>
                    <EmptyTitle>No errors recorded.</EmptyTitle>
                    <EmptyDescription>Good sign.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </li>
            )}
            {moreErrors && (
              <li className="px-4 py-2 text-center text-xs text-muted-foreground">Showing the most recent {ERROR_LIMIT}.</li>
            )}
          </ul>
        </section>
      )}

      {isAdmin && (
        <section id="activity" className="mt-10">
          <h2 className="font-display text-lg font-semibold">Activity log</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Who did what, when — every action by staff and candidates across the system.
            Admins only.
          </p>
          <form action="/app/settings#activity" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">From</span>
              <Input type="date" name="from" defaultValue={lo} className="mt-1 w-40" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">To (leave empty for a single day)</span>
              <Input type="date" name="to" defaultValue={filtered && hi !== lo ? hi : ''} className="mt-1 w-40" />
            </label>
            <Button type="submit" variant="secondary">Filter</Button>
            {filtered && (
              <a href="/app/settings#activity" className="text-sm text-muted-foreground underline">Clear</a>
            )}
          </form>
          <ul className="mt-4 divide-y divide-border rounded-xl bg-card text-sm ring-1 ring-foreground/10">
            {auditRows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <strong>{r.actor ?? (r.actor_id ? 'former user' : 'candidate')}</strong>{' '}
                  {r.action.replace(/_/g, ' ')} {r.entity} {r.entity_id}
                  {Object.keys(r.detail).length > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (
                      {Object.entries(r.detail)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(', ')}
                      )
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">{fmtDateTime(r.created_at)}</span>
              </li>
            ))}
            {auditRows.length === 0 && (
              <li>
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{filtered ? 'No activity in this period.' : 'No activity recorded yet.'}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              </li>
            )}
          </ul>
          {(page > 1 || moreAudit) && (
            <nav className="mt-3 flex items-center justify-between text-sm">
              {page > 1 ? (
                <a href={pageHref(page - 1)} className="underline">← Newer</a>
              ) : <span />}
              <span className="text-xs text-muted-foreground">
                Page {page} · entries {(page - 1) * AUDIT_LIMIT + 1}–{(page - 1) * AUDIT_LIMIT + auditRows.length}
              </span>
              {moreAudit ? (
                <a href={pageHref(page + 1)} className="underline">Older →</a>
              ) : <span />}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

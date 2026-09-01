import { q } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { DEFAULT_TEMPLATES, getMailService, mailConfigured } from '@/lib/email';
import { fmtDateTime } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import { saveTemplate, setMailService } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await currentUser();
  const isAdmin = user.role === 'admin';
  const mailService = await getMailService();
  const configured = mailConfigured();

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
         order by l.id desc limit 200`
      )
    : { rows: [] };

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
         from public.error_log order by id desc limit 100`
      )
    : { rows: [] };

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Settings</h1>

      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold">Mail service</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Which service sends candidate emails. If a send fails twice on the selected service, the
          system automatically falls back to the other one.
        </p>
        <form action={setMailService} className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="service" value="resend" defaultChecked={mailService === 'resend'} className="accent-pine" />
            Resend
            <span className={`text-xs ${configured.resend ? 'text-pine-deep' : 'text-rust'}`}>
              {configured.resend ? 'configured' : 'not configured — set RESEND_API_KEY'}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="service" value="gmail" defaultChecked={mailService === 'gmail'} className="accent-pine" />
            Gmail (Workspace SMTP)
            <span className={`text-xs ${configured.gmail ? 'text-pine-deep' : 'text-rust'}`}>
              {configured.gmail ? 'configured' : 'not configured — set GMAIL_USER + GMAIL_APP_PASSWORD'}
            </span>
          </label>
          <SubmitButton className="btn-primary" pendingLabel="Saving…" doneMessage="Mail service updated">
            Save
          </SubmitButton>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold">Email templates</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Placeholders like {'{{name}}'} are filled automatically. Clear both fields and save to
          revert a template to its default.
        </p>
        <div className="mt-4 space-y-3">
          {Object.entries(DEFAULT_TEMPLATES).map(([key, def]) => {
            const o = byKey.get(key);
            return (
              <details key={key} className="rounded-lg border border-line bg-card p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  {key}
                  {o && <span className="ml-2 rounded-full bg-pine-wash px-2 py-0.5 text-xs text-pine-deep">customized</span>}
                  <span className="ml-2 text-xs text-ink-soft">
                    vars: {def.vars.map((v) => `{{${v}}}`).join(' ')}
                  </span>
                </summary>
                <form action={saveTemplate} className="mt-3 space-y-2">
                  <input type="hidden" name="key" value={key} />
                  <input
                    name="subject"
                    defaultValue={o?.subject ?? def.subject}
                    className="input"
                    aria-label="Subject"
                  />
                  <textarea
                    name="body"
                    rows={6}
                    defaultValue={o?.body ?? def.body}
                    className="input font-mono text-xs"
                    aria-label="Body"
                  />
                  <SubmitButton className="btn-primary" pendingLabel="Saving…">Save template</SubmitButton>
                </form>
              </details>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Data retention</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Candidate PII accumulates indefinitely by default. To anonymize rejected/withdrawn
          candidates older than N days (removes resumes, task files, and personal details;
          keeps anonymous rows for reports), run{' '}
          <code className="rounded bg-paper px-1.5 py-0.5">node scripts/purge.mjs &lt;days&gt; --dry-run</code>{' '}
          from the project — deliberately a manual, dry-run-first operation.
        </p>
      </section>

      {isAdmin && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Errors</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Every error anyone hits — staff, candidates, server or browser — is recorded here
            automatically. Admins only.
          </p>
          <ul className="mt-4 space-y-2">
            {errorRows.map((e) => (
              <li key={e.id} className="rounded-lg border border-line bg-card">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="rounded-full bg-rust/10 px-2 py-0.5 text-xs font-medium text-rust">
                      {e.source}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.message}</span>
                    <span className="text-ink-soft">{fmtDateTime(e.created_at)}</span>
                  </summary>
                  <div className="border-t border-line px-4 py-3 text-xs">
                    {Object.keys(e.context).length > 0 && (
                      <p className="mb-2 text-ink-soft">
                        {Object.entries(e.context)
                          .filter(([, v]) => v !== '' && v != null)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ')}
                      </p>
                    )}
                    {e.stack && (
                      <pre className="overflow-x-auto rounded bg-paper p-2 font-mono">{e.stack}</pre>
                    )}
                  </div>
                </details>
              </li>
            ))}
            {errorRows.length === 0 && (
              <li className="rounded-lg border border-line bg-card px-4 py-6 text-center text-sm text-ink-soft">
                No errors recorded. Good sign.
              </li>
            )}
          </ul>
        </section>
      )}

      {isAdmin && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Activity log</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Who did what, when — every action by staff and candidates across the system.
            Admins only.
          </p>
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-card text-sm">
            {auditRows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <strong>{r.actor ?? (r.actor_id ? 'former user' : 'candidate')}</strong>{' '}
                  {r.action.replace(/_/g, ' ')} {r.entity} {r.entity_id}
                  {Object.keys(r.detail).length > 0 && (
                    <span className="ml-1 text-xs text-ink-soft">
                      (
                      {Object.entries(r.detail)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(', ')}
                      )
                    </span>
                  )}
                </span>
                <span className="text-ink-soft">{fmtDateTime(r.created_at)}</span>
              </li>
            ))}
            {auditRows.length === 0 && (
              <li className="px-4 py-6 text-center text-ink-soft">No activity recorded yet.</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import { portalUrl } from '@/lib/email';
import { fmtDate, fmtDateTime } from '@/lib/tz';
import { allFields, type FormSchema } from '@/lib/form-schema';
import { parseSubmissionFields } from '@/lib/brief';
import SubmitButton from '@/components/SubmitButton';
import LinkifyText from '@/components/LinkifyText';
import Flash from '@/components/Flash';
import { FEEDBACK_JOIN, PIPELINE_SORTS, PIPELINE_WHERE, pipelineWhereParams, type PipelineCtx } from '@/lib/pipeline';
import {
  addFeedback,
  addNote,
  bulkPipeline,
  composeEmail,
  resendEmail,
  staffBookSlot,
  staffCancelSlot,
  updateCandidate,
  updateTags,
} from '../actions';
import { pipelineFlash } from '../flash';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [a],
  } = await q<{ name: string }>('select name from public.applications where id = $1', [Number(id)]);
  return { title: a ? a.name : 'Candidate' };
}

const EMAIL_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-amber/15 text-amber',
  sent: 'bg-pine-wash text-pine-deep',
  pending: 'bg-amber/15 text-amber',
  failed: 'bg-rust/10 text-rust',
  cancelled: 'bg-line text-ink-soft',
};

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-pine-wash text-pine-deep',
  hired: 'bg-pine text-white',
  rejected: 'bg-rust/10 text-rust',
  withdrawn: 'bg-line text-ink-soft',
};

export default async function CandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ o?: string; ok?: string; e?: string } & PipelineCtx>;
}) {
  const { id } = await params;
  const { o, ok, e: err, ...ctx } = await searchParams;
  const appId = Number(id);
  const user = await currentUser();

  const {
    rows: [a],
  } = await q<{
    id: number;
    opening_id: number;
    name: string;
    email: string;
    phone: string;
    resume_path: string;
    answers: Record<string, unknown>;
    score: string | null;
    max_score: string | null;
    utm: Record<string, string>;
    tags: string[];
    status: string;
    current_stage_id: number | null;
    portal_token: string;
    created_at: Date;
    opening_title: string;
    schema: FormSchema;
  }>(
    `select a.*, o.title as opening_title, f.schema
     from public.applications a
     join public.openings o on o.id = a.opening_id
     join public.forms f on f.id = a.form_id
     where a.id = $1`,
    [appId]
  );
  if (!a || !(await canAccessOpening(user, Number(a.opening_id)))) notFound();

  const [{ rows: stages }, { rows: history }, { rows: feedback }, { rows: notes }, { rows: subs }, { rows: slots }, { rows: emails }, { rows: taskStages }, { rows: responses }] =
    await Promise.all([
      q<{ id: number; name: string }>(
        `select id, name from public.stages where opening_id = $1 order by position`,
        [a.opening_id]
      ),
      q<{ from_name: string | null; to_name: string | null; by_name: string | null; created_at: Date }>(
        `select fs.name as from_name, ts.name as to_name, p.full_name as by_name, h.created_at
         from public.stage_history h
         left join public.stages fs on fs.id = h.from_stage_id
         left join public.stages ts on ts.id = h.to_stage_id
         left join public.profiles p on p.id = h.changed_by
         where h.application_id = $1 order by h.id desc`,
        [appId]
      ),
      q<{ author: string; author_id: string; stage_id: number | null; stage: string | null; rating: number | null; comment: string; created_at: Date }>(
        `select p.full_name as author, f.author_id, f.stage_id, s.name as stage, f.rating, f.comment, f.created_at
         from public.feedback f
         join public.profiles p on p.id = f.author_id
         left join public.stages s on s.id = f.stage_id
         where f.application_id = $1 order by f.created_at desc`,
        [appId]
      ),
      q<{ author: string; body: string; created_at: Date }>(
        `select p.full_name as author, n.body, n.created_at
         from public.notes n join public.profiles p on p.id = n.author_id
         where n.application_id = $1 order by n.created_at desc`,
        [appId]
      ),
      q<{ id: number; title: string; field_id: string; file_path: string; file_name: string; link_url: string; note: string; stage: string | null; created_at: Date }>(
        `select su.id, su.title, su.field_id, su.file_path, su.file_name, su.link_url, su.note, s.name as stage, su.created_at
         from public.submissions su
         left join public.stages s on s.id = su.stage_id
         where su.application_id = $1 order by su.created_at desc`,
        [appId]
      ),
      q<{ id: number; starts_at: Date; duration_mins: number; stage: string; interviewer: string }>(
        `select sl.id, sl.starts_at, sl.duration_mins, st.name as stage, p.full_name as interviewer
         from public.slots sl
         join public.stages st on st.id = sl.stage_id
         join public.profiles p on p.id = sl.interviewer_id
         where sl.application_id = $1 order by sl.starts_at`,
        [appId]
      ),
      q<{ id: number; template: string; subject: string; body: string; to_email: string; status: string; service: string; error: string; created_at: Date }>(
        `select id, template, subject, body, to_email, status, service, error, created_at from public.email_log
         where application_id = $1 order by id desc`,
        [appId]
      ),
      q<{ stage: string; submission_fields: unknown }>(
        `select name as stage, submission_fields from public.stages
         where opening_id = $1 and kind = 'task' order by position`,
        [a.opening_id]
      ),
      q<{ response: string; created_at: Date }>(
        `select response, created_at from public.task_responses
         where application_id = $1 order by id`,
        [appId]
      ),
    ]);

  // the task's asked-for items, so the profile shows all of them — submitted or not
  const requirements = taskStages.flatMap((ts) =>
    parseSubmissionFields(ts.submission_fields).map((f) => ({ ...f, stage: ts.stage }))
  );
  const reqIds = new Set(requirements.map((r) => r.id));
  const extraSubs = subs.filter((s) => !reqIds.has(s.field_id));

  const {
    rows: [stageInfo],
  } = await q<{ kind: string; name: string } | never>(
    `select kind, name from public.stages where id = $1`,
    [a.current_stage_id]
  );
  const openSlots =
    a.status === 'active' && stageInfo?.kind === 'interview' && slots.length === 0
      ? (
          await q<{ id: number; starts_at: Date; interviewer: string }>(
            `select sl.id, sl.starts_at, p.full_name as interviewer
             from public.slots sl join public.profiles p on p.id = sl.interviewer_id
             where sl.stage_id = $1 and sl.application_id is null and sl.starts_at > now()
             order by sl.starts_at limit 31`,
            [a.current_stage_id]
          )
        ).rows
      : [];
  const moreSlots = openSlots.length > 30;
  if (moreSlots) openSlots.pop();
  // invited to interview but nothing to book — the invite email already went out
  const noOpenSlots =
    a.status === 'active' && stageInfo?.kind === 'interview' && slots.length === 0 && openSlots.length === 0;

  // the current author's feedback for the current stage, if any — the form
  // updates it rather than silently overwriting
  const myFeedback = feedback.find((f) => f.author_id === user.id && f.stage_id === a.current_stage_id);
  const selfHref = `/app/candidates/${a.id}`;

  // prev/next within the pipeline list the reviewer came from (?o=… carries its filters)
  const navQs = new URLSearchParams({ o: String(o ?? ''), ...ctx } as Record<string, string>).toString();
  let nav: { prev?: number; next?: number; pos: number; total: number } | null = null;
  if (Number(o) === a.opening_id) {
    const { rows: ids } = await q<{ id: number }>(
      `select a.id from public.applications a
       ${FEEDBACK_JOIN}
       where ${PIPELINE_WHERE}
       order by ${PIPELINE_SORTS[ctx.sort ?? ''] ?? PIPELINE_SORTS.score}`,
      pipelineWhereParams(a.opening_id, ctx)
    );
    const i = ids.findIndex((r) => r.id === appId);
    if (i !== -1) {
      nav = { prev: ids[i - 1]?.id, next: ids[i + 1]?.id, pos: i + 1, total: ids.length };
    }
  }

  const { rows: alsoApplied } = await q<{ id: number; title: string; status: string }>(
    `select a2.id, o.title, a2.status
     from public.applications a2 join public.openings o on o.id = a2.opening_id
     where a2.email = $1 and a2.id <> $2 order by a2.created_at desc`,
    [a.email, a.id]
  );

  const labels = new Map(allFields(a.schema).map((f) => [f.id, f.label || f.id]));
  const fmt = fmtDateTime;
  const source = Object.entries(a.utm)
    .map(([k, v]) => `${k.replace('utm_', '')}: ${v}`)
    .join(' · ');
  const timeline = [
    ...history.map((h) => ({
      at: h.created_at,
      kind: 'stage' as const,
      text: `${h.from_name ? `${h.from_name} → ` : ''}`,
      strong: h.to_name ?? '',
      extra: h.by_name ?? '',
    })),
    ...emails.map((e) => ({
      at: e.created_at,
      kind: 'email' as const,
      text: e.status === 'sent' ? 'Email: ' : `Email (${e.status}): `,
      strong: e.subject,
      extra: '',
    })),
    ...responses.map((r, i) => ({
      at: r.created_at,
      kind: 'response' as const,
      text: i === 0 ? 'Task response: ' : 'Changed task response to: ',
      strong: r.response === 'yes' ? 'Yes' : 'No',
      extra: '',
    })),
    ...feedback.map((f) => ({
      at: f.created_at,
      kind: 'feedback' as const,
      text: 'Feedback: ',
      strong: `${f.rating ? '★'.repeat(f.rating) + ' ' : ''}${f.comment}`.trim() || '(no comment)',
      extra: f.author,
    })),
    ...notes.map((n) => ({
      at: n.created_at,
      kind: 'note' as const,
      text: 'Note: ',
      strong: n.body.length > 120 ? `${n.body.slice(0, 120)}…` : n.body,
      extra: n.author,
    })),
    ...subs.map((s) => ({
      at: s.created_at,
      kind: 'submission' as const,
      text: 'Task submitted: ',
      strong: s.title || s.file_name || s.link_url || 'submission',
      extra: '',
    })),
    ...slots.map((s) => ({
      at: s.starts_at,
      kind: 'interview' as const,
      text: s.starts_at > new Date() ? 'Interview booked: ' : 'Interview: ',
      strong: `${s.stage} with ${s.interviewer}`,
      extra: '',
    })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
  const dot: Record<string, string> = {
    stage: 'bg-pine',
    email: 'bg-amber',
    response: 'bg-amber',
    feedback: 'bg-ink-soft',
    note: 'bg-line',
    submission: 'bg-pine-deep',
    interview: 'bg-pine-wash border border-pine',
  };

  const navArrow = (id: number | undefined, label: string) =>
    id ? (
      <Link href={`/app/candidates/${id}?${navQs}`} className="btn-quiet !py-1">
        {label}
      </Link>
    ) : (
      <span className="btn-quiet !py-1 cursor-default opacity-40">{label}</span>
    );

  const flash = pipelineFlash(ok, err);
  return (
    <div>
      <Flash kind={flash?.kind ?? 'success'} message={flash?.message} />
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/candidates" />
        {nav && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            {navArrow(nav.prev, '← Prev')}
            <span className="text-ink-soft">
              {nav.pos} of {nav.total}
            </span>
            {navArrow(nav.next, 'Next →')}
          </div>
        )}
      </div>
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">
            <Link href={`/app/openings/${a.opening_id}/applications`} className="hover:underline">
              {a.opening_title}
            </Link>
            {' · '}
            <Link href={`/app/emails?q=${encodeURIComponent(a.email)}`} className="hover:underline">
              Emails
            </Link>
          </p>
          <h1 className="font-display text-3xl font-bold">{a.name}</h1>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[a.status]}`}>
            {a.status}
          </span>
          {a.score != null && (
            <span className="rounded-full bg-amber/15 px-3 py-1 text-sm font-medium text-amber">
              score {a.score}
              {Number(a.max_score) > 0 && ` / ${a.max_score}`}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-soft">
        <span>{a.email}</span>
        {a.phone && <span>{a.phone}</span>}
        <span>applied {fmtDate(a.created_at)}</span>
        {source && <span title="Ad source">via {source}</span>}
        {a.resume_path && (
          <a href={`/api/files/${a.resume_path}`} target="_blank" className="text-pine underline">
            Resume
          </a>
        )}
        <a
          href={portalUrl(a.portal_token)}
          target="_blank"
          className="btn-quiet !py-1 text-pine"
          title="The candidate's private status page — where they track progress, book interviews, and submit tasks. Share this link if they lose their email."
        >
          Candidate portal ↗
        </a>
        <details className="basis-full">
          <summary className="cursor-pointer text-pine hover:underline">Edit details</summary>
          <form action={updateCandidate} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="applicationId" value={a.id} />
            <div className="min-w-40 flex-1">
              <label className="field-label" htmlFor="edit-name">Name</label>
              <input id="edit-name" name="name" required defaultValue={a.name} className="input py-1.5" />
            </div>
            <div className="min-w-48 flex-1">
              <label className="field-label" htmlFor="edit-email">Email</label>
              <input id="edit-email" name="email" type="email" required defaultValue={a.email} className="input py-1.5" />
            </div>
            <div className="w-40">
              <label className="field-label" htmlFor="edit-phone">Phone</label>
              <input id="edit-phone" name="phone" defaultValue={a.phone} className="input py-1.5" />
            </div>
            <SubmitButton className="btn-quiet" pendingLabel="Saving…">Save details</SubmitButton>
          </form>
        </details>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {a.tags.map((t) => (
          <form key={t} action={updateTags}>
            <input type="hidden" name="applicationId" value={a.id} />
            <input type="hidden" name="remove" value={t} />
            <button
              className="rounded-full bg-pine-wash px-2.5 py-0.5 text-xs font-medium text-pine-deep hover:bg-rust/10 hover:text-rust"
              title="Remove tag"
            >
              {t} ✕
            </button>
          </form>
        ))}
        <form action={updateTags} className="flex items-center gap-1">
          <input type="hidden" name="applicationId" value={a.id} />
          <input name="add" aria-label="New tag" placeholder="+ tag" className="input w-28 px-2 py-0.5 text-xs" />
          <SubmitButton className="btn-quiet !px-2 !py-0.5 text-xs" pendingLabel="…">Add</SubmitButton>
        </form>
      </div>

      <form action={bulkPipeline} className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-4 py-3 text-sm">
        <input type="hidden" name="openingId" value={a.opening_id} />
        <input type="hidden" name="appId" value={a.id} />
        <input type="hidden" name="back" value={`${selfHref}?${navQs}`} />
        <label className="sr-only" htmlFor="stageId">Stage to move to</label>
        <select id="stageId" name="stageId" className="input w-44 py-1.5" defaultValue={a.current_stage_id ?? undefined}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <SubmitButton name="intent" value="move" className="btn-quiet" pendingLabel="Moving…">Move to stage</SubmitButton>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" name="notify" value="1" defaultChecked className="accent-pine" />
          Email the candidate about this move
        </label>
        <div className="mx-2 h-5 w-px bg-line" />
        {a.status === 'active' ? (
          <>
            <SubmitButton name="intent" value="hire" className="btn-quiet text-pine-deep" pendingLabel="Hiring…" confirmText={`Mark ${a.name} as hired? They will get the congratulations email.`}>Mark hired</SubmitButton>
            <SubmitButton name="intent" value="reject_send" className="btn-danger" pendingLabel="Rejecting…" confirmText={`Reject ${a.name} and email them now?`}>Reject + email now</SubmitButton>
            <SubmitButton name="intent" value="reject_draft" className="btn-danger" pendingLabel="Rejecting…" confirmText={`Reject ${a.name}? The email is drafted in Emails for you to send later.`} title="Rejects and drafts the email — send it manually from the Emails tab">Reject + draft email</SubmitButton>
            <SubmitButton name="intent" value="withdraw" className="btn-quiet" pendingLabel="Updating…" confirmText={`Mark ${a.name} as withdrawn? No email is sent.`} title="For candidates who told you they are no longer interested">Mark withdrawn</SubmitButton>
          </>
        ) : (
          <SubmitButton name="intent" value="restore" className="btn-quiet" pendingLabel="Restoring…">Restore to active</SubmitButton>
        )}
      </form>
      <p className="mt-2 text-xs text-ink-soft">
        Task and interview stages email instructions; other forward moves send a short update;
        backward moves never email. Untick the box to move silently.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          {a.resume_path.endsWith('.pdf') && (
            <section>
              <h2 className="font-display text-lg font-semibold">Resume</h2>
              <iframe
                src={`/api/files/${a.resume_path}`}
                title="Resume preview"
                className="mt-3 h-96 w-full rounded-lg border border-line bg-card"
              />
            </section>
          )}

          <section>
            <h2 className="font-display text-lg font-semibold">Application</h2>
            <dl className="mt-3 space-y-3 rounded-lg border border-line bg-card p-4 text-sm">
              {Object.entries(a.answers).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-ink-soft">{labels.get(k) ?? k}</dt>
                  <dd className="mt-0.5 whitespace-pre-line font-medium">
                    <LinkifyText value={v} />
                  </dd>
                </div>
              ))}
              {Object.keys(a.answers).length === 0 && (
                <p className="text-ink-soft">No custom questions were on this form.</p>
              )}
            </dl>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Task submissions</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {requirements.map((r) => {
                const rows = subs.filter((s) => s.field_id === r.id);
                return (
                  <li key={r.id} className="rounded-lg border border-line bg-card p-3">
                    <span className="mr-2 font-medium">{r.title}</span>
                    <span className={`mr-2 text-xs ${r.required ? 'text-rust' : 'text-ink-soft'}`}>
                      {r.required ? 'required' : 'optional'}
                    </span>
                    {rows.length === 0 ? (
                      <span className="text-amber">Not submitted yet</span>
                    ) : (
                      rows.map((s, i) => (
                        <span key={s.id} className={i > 0 ? 'mt-1 block pl-4' : ''}>
                          {s.file_path && (
                            <a href={`/api/files/${s.file_path}`} target="_blank" className="font-medium text-pine underline">
                              {s.file_name || 'file'}
                            </a>
                          )}
                          {s.link_url && (
                            <a
                              href={s.link_url}
                              target="_blank"
                              rel="noopener"
                              className={`font-medium text-pine underline ${s.file_path ? 'ml-2' : ''}`}
                            >
                              link ↗
                            </a>
                          )}
                          <span className="ml-2 text-ink-soft">
                            {i > 0 && 'earlier version · '}
                            {fmt(s.created_at)}
                          </span>
                          {s.note && <span className="ml-2 text-ink-soft">— {s.note}</span>}
                        </span>
                      ))
                    )}
                  </li>
                );
              })}
              {extraSubs.map((s) => (
                <li key={s.id} className="rounded-lg border border-line bg-card p-3">
                  <span className="mr-2 font-medium">{s.title || 'Submission'}</span>
                  {s.file_path && (
                    <a href={`/api/files/${s.file_path}`} target="_blank" className="font-medium text-pine underline">
                      {s.file_name || 'file'}
                    </a>
                  )}
                  {s.link_url && (
                    <a
                      href={s.link_url}
                      target="_blank"
                      rel="noopener"
                      className={`font-medium text-pine underline ${s.file_path ? 'ml-2' : ''}`}
                    >
                      link ↗
                    </a>
                  )}
                  <span className="ml-2 text-ink-soft">
                    {s.stage ?? ''} · {fmt(s.created_at)}
                  </span>
                  {s.note && <p className="mt-1 whitespace-pre-line text-ink-soft">{s.note}</p>}
                </li>
              ))}
              {requirements.length === 0 && subs.length === 0 && (
                <li className="text-ink-soft">Nothing submitted yet.</li>
              )}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Emails sent</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {emails.map((e) => (
                <li key={e.id} className="rounded-lg border border-line bg-card">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${EMAIL_STATUS_STYLE[e.status] ?? 'bg-line text-ink-soft'}`}>
                        {e.status}
                      </span>
                      <span className="font-medium">{e.subject}</span>
                      <span className="text-xs text-ink-soft">
                        {e.template} · {fmt(e.created_at)}{e.service ? ` · via ${e.service}` : ''}
                      </span>
                    </summary>
                    <div className="border-t border-line px-3 py-2">
                      <p className="text-xs text-ink-soft">to {e.to_email}</p>
                      <p className="mt-1 whitespace-pre-line">{e.body}</p>
                      {e.error && <p className="mt-2 text-rust">error: {e.error}</p>}
                      {(e.status === 'sent' || e.status === 'failed') && (
                        <form action={resendEmail} className="mt-2">
                          <input type="hidden" name="applicationId" value={a.id} />
                          <input type="hidden" name="emailId" value={e.id} />
                          <SubmitButton className="btn-quiet !py-1" pendingLabel="Resending…" doneMessage="Email queued — status updates below">
                            Resend this email
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </details>
                </li>
              ))}
              {emails.length === 0 && <li className="text-ink-soft">No emails sent yet.</li>}
            </ul>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Interviews</h2>
              <Link
                href={`/app/openings/${a.opening_id}/slots`}
                className="text-sm text-pine underline"
              >
                Interview slots →
              </Link>
            </div>
            {noOpenSlots && (
              <p className="mt-3 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">
                No open slots for {stageInfo?.name ?? 'this stage'}. {a.name} has the interview invite but
                nothing to book.{' '}
                <Link href={`/app/openings/${a.opening_id}/slots`} className="underline">Create slots</Link>
              </p>
            )}
            <ul className="mt-3 space-y-2 text-sm">
              {slots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card p-3">
                  <span>
                    <span className="font-medium">{fmt(s.starts_at)}</span>
                    <span className="text-ink-soft"> · {s.duration_mins}m · {s.stage} · with {s.interviewer}</span>
                  </span>
                  {s.starts_at > new Date() && (
                    <form action={staffCancelSlot}>
                      <input type="hidden" name="applicationId" value={a.id} />
                      <input type="hidden" name="slotId" value={s.id} />
                      <SubmitButton
                        className="btn-danger !py-1"
                        pendingLabel="Cancelling…"
                        confirmText={`Cancel the ${fmt(s.starts_at)} interview? ${a.name} and ${s.interviewer} will be emailed.`}
                      >
                        Cancel interview
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
              {slots.length === 0 && <li className="text-ink-soft">No interview booked.</li>}
            </ul>
            {openSlots.length > 0 && (
              <form action={staffBookSlot} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="applicationId" value={a.id} />
                <label className="sr-only" htmlFor="slotId">Open slot</label>
                <select id="slotId" name="slotId" className="input flex-1 py-1.5">
                  {openSlots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmt(s.starts_at)} — {s.interviewer}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn-quiet" pendingLabel="Booking…">Book for candidate</SubmitButton>
                {moreSlots && <span className="basis-full text-xs text-ink-soft">Showing the first 30 open slots.</span>}
              </form>
            )}
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Timeline</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[t.kind] ?? 'bg-amber'}`} />
                  <span>
                    {t.text}
                    <strong>{t.strong}</strong>
                    <span className="text-ink-soft"> · {fmt(t.at)}{t.extra ? ` · ${t.extra}` : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {alsoApplied.length > 0 && (
            <section>
              <h2 className="font-display text-lg font-semibold">Also applied to</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {alsoApplied.map((x) => (
                  <li key={x.id}>
                    <Link href={`/app/candidates/${x.id}`} className="text-pine underline">
                      {x.title}
                    </Link>
                    <span className="text-ink-soft"> · {x.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="font-display text-lg font-semibold">Feedback</h2>
            <form action={addFeedback} className="mt-3 rounded-lg border border-line bg-card p-4 text-sm">
              <input type="hidden" name="applicationId" value={a.id} />
              <div className="flex flex-wrap items-center gap-2">
                <select name="rating" aria-label="Rating" className="input w-32" defaultValue={myFeedback?.rating ?? ''}>
                  <option value="">No rating</option>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>{'★'.repeat(r)} {r}/5</option>
                  ))}
                </select>
                <input
                  name="comment"
                  aria-label="Feedback comment"
                  placeholder="Your verdict for the current stage…"
                  defaultValue={myFeedback?.comment ?? ''}
                  className="input min-w-48 flex-1"
                />
                <SubmitButton className="btn-primary" pendingLabel="Saving…" doneMessage={myFeedback ? 'Feedback updated' : 'Feedback saved'}>
                  {myFeedback ? 'Update feedback' : 'Save'}
                </SubmitButton>
              </div>
              {myFeedback && (
                <p className="mt-2 text-xs text-ink-soft">
                  You already left feedback for this stage on {fmt(myFeedback.created_at)} — saving replaces it.
                </p>
              )}
            </form>
            <ul className="mt-3 space-y-2 text-sm">
              {feedback.map((f, i) => (
                <li key={i} className="rounded-lg border border-line bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{f.author}</span>
                    <span className="text-amber">{f.rating ? '★'.repeat(f.rating) : ''}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line">{f.comment}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {f.stage ?? 'General'} · {fmt(f.created_at)}
                  </p>
                </li>
              ))}
              {feedback.length === 0 && <li className="text-ink-soft">No feedback yet.</li>}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Email the candidate</h2>
            <form action={composeEmail} className="mt-3 space-y-2 rounded-lg border border-line bg-card p-4 text-sm">
              <input type="hidden" name="applicationId" value={a.id} />
              <input name="subject" required placeholder="Subject" className="input" />
              <textarea name="body" required rows={3} placeholder="Message — sent as plain text and logged in the timeline" className="input" />
              <SubmitButton className="btn-primary" pendingLabel="Sending…">Send email</SubmitButton>
            </form>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Notes</h2>
            <form action={addNote} className="mt-3 flex gap-2">
              <input type="hidden" name="applicationId" value={a.id} />
              <input name="body" placeholder="Add an internal note…" className="input flex-1" />
              <SubmitButton className="btn-primary" pendingLabel="Adding…">Add</SubmitButton>
            </form>
            <ul className="mt-3 space-y-2 text-sm">
              {notes.map((n, i) => (
                <li key={i} className="rounded-lg border border-line bg-card p-3">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-ink-soft">{n.author} · {fmt(n.created_at)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

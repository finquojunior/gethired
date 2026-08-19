import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { portalUrl } from '@/lib/email';
import { fmtDate, fmtDateTime } from '@/lib/tz';
import { allFields, type FormSchema } from '@/lib/form-schema';
import SubmitButton from '@/components/SubmitButton';
import {
  addFeedback,
  addNote,
  bulkPipeline,
  composeEmail,
  staffBookSlot,
  staffCancelSlot,
  updateTags,
} from '../actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-pine-wash text-pine-deep',
  hired: 'bg-pine text-white',
  rejected: 'bg-rust/10 text-rust',
  withdrawn: 'bg-line text-ink-soft',
};

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);

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
  if (!a) notFound();

  const [{ rows: stages }, { rows: history }, { rows: feedback }, { rows: notes }, { rows: subs }, { rows: slots }, { rows: emails }] =
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
      q<{ author: string; stage: string | null; rating: number | null; comment: string; created_at: Date }>(
        `select p.full_name as author, s.name as stage, f.rating, f.comment, f.created_at
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
      q<{ id: number; file_path: string; note: string; stage: string | null; created_at: Date }>(
        `select su.id, su.file_path, su.note, s.name as stage, su.created_at
         from public.submissions su
         left join public.stages s on s.id = su.stage_id
         where su.application_id = $1 order by su.created_at desc`,
        [appId]
      ),
      q<{ starts_at: Date; duration_mins: number; stage: string; interviewer: string }>(
        `select sl.starts_at, sl.duration_mins, st.name as stage, p.full_name as interviewer
         from public.slots sl
         join public.stages st on st.id = sl.stage_id
         join public.profiles p on p.id = sl.interviewer_id
         where sl.application_id = $1 order by sl.starts_at`,
        [appId]
      ),
      q<{ template: string; subject: string; created_at: Date }>(
        `select template, subject, created_at from public.email_log
         where application_id = $1 order by id desc`,
        [appId]
      ),
    ]);

  const {
    rows: [stageInfo],
  } = await q<{ kind: string } | never>(
    `select kind from public.stages where id = $1`,
    [a.current_stage_id]
  );
  const openSlots =
    a.status === 'active' && stageInfo?.kind === 'interview' && slots.length === 0
      ? (
          await q<{ id: number; starts_at: Date; interviewer: string }>(
            `select sl.id, sl.starts_at, p.full_name as interviewer
             from public.slots sl join public.profiles p on p.id = sl.interviewer_id
             where sl.stage_id = $1 and sl.application_id is null and sl.starts_at > now()
             order by sl.starts_at limit 30`,
            [a.current_stage_id]
          )
        ).rows
      : [];

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
      text: 'Email: ',
      strong: e.subject,
      extra: '',
    })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());

  return (
    <div>
      <BackButton fallback="/app/candidates" />
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">
            <Link href={`/app/openings/${a.opening_id}/applications`} className="hover:underline">
              {a.opening_title}
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
          <input name="add" placeholder="+ tag" className="input w-28 px-2 py-0.5 text-xs" />
        </form>
      </div>

      <form action={bulkPipeline} className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-4 py-3 text-sm">
        <input type="hidden" name="openingId" value={a.opening_id} />
        <input type="hidden" name="appId" value={a.id} />
        <select name="stageId" className="input w-44 py-1.5" defaultValue={a.current_stage_id ?? undefined}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <SubmitButton name="intent" value="move" className="btn-quiet" pendingLabel="Moving…">Move to stage</SubmitButton>
        <div className="mx-2 h-5 w-px bg-line" />
        {a.status === 'active' ? (
          <>
            <SubmitButton name="intent" value="hire" className="btn-quiet text-pine-deep" pendingLabel="Hiring…">Mark hired</SubmitButton>
            <SubmitButton name="intent" value="reject" className="btn-quiet text-rust" pendingLabel="Rejecting…">Reject</SubmitButton>
            <label className="flex items-center gap-1.5 text-ink-soft">
              <input type="checkbox" name="sendRejectEmail" value="1" className="accent-pine" />
              send email (30 min undo)
            </label>
          </>
        ) : (
          <SubmitButton name="intent" value="restore" className="btn-quiet" pendingLabel="Restoring…">Restore to active</SubmitButton>
        )}
      </form>

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
                    {Array.isArray(v) ? v.join(', ') : String(v)}
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
              {subs.map((s) => (
                <li key={s.id} className="rounded-lg border border-line bg-card p-3">
                  <a href={`/api/files/${s.file_path}`} target="_blank" className="font-medium text-pine underline">
                    Submission
                  </a>
                  <span className="ml-2 text-ink-soft">
                    {s.stage ?? ''} · {fmt(s.created_at)}
                  </span>
                  {s.note && <p className="mt-1 whitespace-pre-line text-ink-soft">{s.note}</p>}
                </li>
              ))}
              {subs.length === 0 && <li className="text-ink-soft">Nothing submitted yet.</li>}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Interviews</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {slots.map((s, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-line bg-card p-3">
                  <span>
                    <span className="font-medium">{fmt(s.starts_at)}</span>
                    <span className="text-ink-soft"> · {s.duration_mins}m · {s.stage} · with {s.interviewer}</span>
                  </span>
                  {s.starts_at > new Date() && (
                    <form action={staffCancelSlot}>
                      <input type="hidden" name="applicationId" value={a.id} />
                      <SubmitButton className="text-rust hover:underline" pendingLabel="…">Cancel</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
              {slots.length === 0 && <li className="text-ink-soft">No interview booked.</li>}
            </ul>
            {openSlots.length > 0 && (
              <form action={staffBookSlot} className="mt-3 flex items-center gap-2 text-sm">
                <input type="hidden" name="applicationId" value={a.id} />
                <select name="slotId" className="input flex-1 py-1.5">
                  {openSlots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmt(s.starts_at)} — {s.interviewer}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn-quiet" pendingLabel="Booking…">Book for candidate</SubmitButton>
              </form>
            )}
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Timeline</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.kind === 'stage' ? 'bg-pine' : 'bg-amber'}`} />
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
              <div className="flex items-center gap-2">
                <select name="rating" className="input w-28">
                  <option value="">No rating</option>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>{'★'.repeat(r)}</option>
                  ))}
                </select>
                <input name="comment" placeholder="Your verdict for the current stage…" className="input flex-1" />
                <SubmitButton className="btn-primary" pendingLabel="Saving…">Save</SubmitButton>
              </div>
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

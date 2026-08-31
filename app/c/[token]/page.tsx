import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { fmtSlot } from '@/lib/tz';
import { TASK_ACCEPT, TASK_MAX_BYTES } from '@/lib/uploads';
import { allFields, type FormSchema } from '@/lib/form-schema';
import LinkifyText from '@/components/LinkifyText';
import DirectUploadForm from '@/components/DirectUploadForm';
import { directUploads } from '@/lib/storage';
import { briefLinks, parseSubmissionFields } from '@/lib/brief';

export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<string, string> = {
  hired: 'You got the role — congratulations! Our team will contact you with next steps.',
  rejected: 'Thanks for your interest. We are not moving forward with your application this time.',
  withdrawn: 'This application has been withdrawn.',
};

const KIND_TEXT: Record<string, string> = {
  screen: 'Your application is being reviewed.',
  task: 'You are in the task round.',
  interview: 'You are in the interview round.',
  offer: 'You are at the offer stage — we will contact you directly.',
};

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e: errorCode } = await searchParams;
  const {
    rows: [a],
  } = await q<{
    id: number;
    name: string;
    status: string;
    title: string;
    stage_id: number | null;
    stage_kind: string | null;
    stage_brief: string | null;
    stage_brief_file: string | null;
    stage_brief_links: string | null;
    submission_fields: unknown;
    answers: Record<string, unknown>;
    schema: FormSchema;
    created_at: Date;
  }>(
    `select a.id, a.name, a.status, o.title, s.id as stage_id, s.kind as stage_kind,
            s.brief as stage_brief, s.brief_file_path as stage_brief_file,
            s.brief_links as stage_brief_links, s.submission_fields, a.answers, f.schema, a.created_at
     from public.applications a
     join public.openings o on o.id = a.opening_id
     join public.forms f on f.id = a.form_id
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1`,
    [token]
  );
  if (!a) notFound();
  const labels = new Map(allFields(a.schema).map((f) => [f.id, f.label || f.id]));

  const showInterview = a.status === 'active' && a.stage_kind === 'interview';
  const showTask = a.status === 'active' && a.stage_kind === 'task';

  const booking = showInterview
    ? (
        await q<{ id: number; starts_at: Date; duration_mins: number; meeting_link: string }>(
          `select id, starts_at, duration_mins, meeting_link from public.slots
           where application_id = $1 and stage_id = $2`,
          [a.id, a.stage_id]
        )
      ).rows[0]
    : undefined;

  const openSlots =
    showInterview && !booking
      ? (
          await q<{ id: number; starts_at: Date; duration_mins: number }>(
            `select id, starts_at, duration_mins from public.slots
             where stage_id = $1 and application_id is null and starts_at > now()
             order by starts_at limit 40`,
            [a.stage_id]
          )
        ).rows
      : [];

  const submissions = showTask
    ? (
        await q<{ id: number; title: string; field_id: string; file_path: string; link_url: string; created_at: Date }>(
          `select id, title, field_id, file_path, link_url, created_at from public.submissions
           where application_id = $1 and stage_id = $2 order by id desc`,
          [a.id, a.stage_id]
        )
      ).rows
    : [];

  const taskLinks = showTask ? briefLinks(a.stage_brief_links) : [];
  const requirements = showTask ? parseSubmissionFields(a.submission_fields) : [];
  // newest submission per requirement (rows arrive newest-first)
  const doneByField = new Map<string, Date>();
  for (const s of submissions) {
    if (s.field_id && !doneByField.has(s.field_id)) doneByField.set(s.field_id, s.created_at);
  }
  const fmt = fmtSlot;
  const canCancel = booking && booking.starts_at.getTime() - Date.now() > 24 * 3600_000;

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-pine">{a.title}</p>
      <h1 className="track mt-2 font-display text-3xl font-bold">Hi {a.name.split(' ')[0]}</h1>

      <p className="mt-6 text-lg">
        {STATUS_TEXT[a.status] ?? KIND_TEXT[a.stage_kind ?? 'screen'] ?? 'Your application is in review.'}
      </p>
      <p className="mt-1 text-sm text-ink-soft">Applied {a.created_at.toISOString().slice(0, 10)}</p>

      {errorCode === 'taken' && (
        <p className="mt-4 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">
          That slot was just taken — pick another one.
        </p>
      )}
      {errorCode === 'file' && (
        <p className="mt-4 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">
          Submission failed — check what the task asks for: a file (PDF, Word, or ZIP up to 16 MB)
          and/or a valid link starting with http.
        </p>
      )}

      {showInterview && booking && (
        <div className="mt-8 rounded-lg border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Your interview</h2>
          <p className="mt-2 text-lg font-medium text-pine-deep">
            {fmt(booking.starts_at)} · {booking.duration_mins} min
          </p>
          {booking.meeting_link && (
            <p className="mt-2 text-sm">
              {/^https?:\/\//.test(booking.meeting_link) ? (
                <a href={booking.meeting_link} className="text-pine underline" target="_blank" rel="noopener">
                  Join the meeting
                </a>
              ) : (
                <span>Location: {booking.meeting_link}</span>
              )}
            </p>
          )}
          {a.stage_brief && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{a.stage_brief}</p>}
          {canCancel ? (
            <form method="post" action={`/c/${token}/cancel`} className="mt-4">
              <button className="btn-quiet text-rust">Cancel booking</button>
              <span className="ml-2 text-xs text-ink-soft">You can rebook another slot after cancelling.</span>
            </form>
          ) : (
            <p className="mt-3 text-xs text-ink-soft">
              Bookings can be changed up to 24 hours before the interview.
            </p>
          )}
        </div>
      )}

      {showInterview && !booking && (
        <div className="mt-8 rounded-lg border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Pick an interview slot</h2>
          {a.stage_brief && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{a.stage_brief}</p>}
          {openSlots.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No open slots right now — we&apos;ll email you when new ones are added.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {openSlots.map((s) => (
                <form key={s.id} method="post" action={`/c/${token}/book`}>
                  <input type="hidden" name="slotId" value={s.id} />
                  <button className="btn-quiet w-full justify-center">
                    {fmt(s.starts_at)}
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      )}

      {showTask && (
        <div className="mt-8 rounded-lg border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Your task</h2>
          <p className="mt-2 whitespace-pre-line text-sm">
            {a.stage_brief || 'Task details will be shared with you by email.'}
          </p>
          {taskLinks.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {taskLinks.map((l) => (
                <li key={l}>
                  <a href={l} target="_blank" rel="noopener" className="break-all text-pine underline">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {a.stage_brief_file && (
            <p className="mt-3">
              <a href={`/c/${token}/brief`} className="btn-quiet inline-flex">
                Download task brief document
              </a>
            </p>
          )}
          {submissions.length > 0 && (
            <div className="mt-3 rounded-md bg-pine-wash px-3 py-2 text-sm text-pine-deep">
              <p className="font-medium">Your submissions</p>
              <ul className="mt-1 space-y-1">
                {submissions.map((s) => (
                  <li key={s.id}>
                    {s.title || 'Submission'}
                    <span className="opacity-70">
                      {' '}
                      · {[s.file_path && 'file', s.link_url && 'link'].filter(Boolean).join(' + ')} ·{' '}
                      {fmt(s.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {requirements.map((r) => {
            const done = doneByField.get(r.id);
            return (
              <DirectUploadForm
                key={r.id}
                direct={directUploads}
                signUrl={`/c/${token}/upload-url`}
                fileField="file"
                maxBytes={TASK_MAX_BYTES}
                method="post"
                action={`/c/${token}/task`}
                encType="multipart/form-data"
                className="mt-4 space-y-3 rounded-md border border-line p-4"
              >
                <input type="hidden" name="field" value={r.id} />
                <input type="hidden" name="filePath" defaultValue="" />
                <input type="hidden" name="fileSig" defaultValue="" />
                <p className="text-sm font-medium">
                  {r.title}{' '}
                  <span className={`text-xs font-normal ${r.required ? 'text-rust' : 'text-ink-soft'}`}>
                    {r.required ? 'required' : 'optional'}
                  </span>
                </p>
                {done && (
                  <p className="text-xs text-pine-deep">
                    Submitted {fmt(done)} — submitting again adds a new version.
                  </p>
                )}
                {r.kind !== 'link' && (
                  <input
                    type="file"
                    name="file"
                    required={r.kind === 'file'}
                    accept={TASK_ACCEPT}
                    className="input"
                  />
                )}
                {r.kind !== 'file' && (
                  <input
                    type="url"
                    name="link"
                    required={r.kind === 'link'}
                    placeholder="https://…"
                    className="input"
                  />
                )}
                <button className="btn-primary">{done ? 'Submit new version' : 'Submit'}</button>
              </DirectUploadForm>
            );
          })}

          <DirectUploadForm
            direct={directUploads}
            signUrl={`/c/${token}/upload-url`}
            fileField="file"
            maxBytes={TASK_MAX_BYTES}
            method="post"
            action={`/c/${token}/task`}
            encType="multipart/form-data"
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="filePath" defaultValue="" />
            <input type="hidden" name="fileSig" defaultValue="" />
            <p className="text-sm font-medium">
              {requirements.length > 0
                ? 'Anything else (optional)'
                : submissions.length > 0
                  ? 'Add another submission'
                  : 'Add a submission'}
            </p>
            <p className="text-xs text-ink-soft">
              Submit as many pieces as your task needs — give each one a title, with a file, a
              link, or both.
            </p>
            <div>
              <label className="field-label">Title</label>
              <input
                type="text"
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Source code, Live demo, Design file…"
                className="input"
              />
            </div>
            <div>
              <label className="field-label">File (optional — PDF, Word, or ZIP up to 16 MB)</label>
              <input type="file" name="file" accept={TASK_ACCEPT} className="input" />
            </div>
            <div>
              <label className="field-label">Link (optional)</label>
              <input
                type="url"
                name="link"
                placeholder="https://github.com/… or https://drive.google.com/…"
                className="input"
              />
            </div>
            <textarea name="note" rows={2} placeholder="Anything we should know? (context)" className="input" />
            <button className="btn-primary">Submit</button>
          </DirectUploadForm>
        </div>
      )}

      {Object.keys(a.answers).length > 0 && (
        <details className="mt-8 rounded-lg border border-line bg-card p-5">
          <summary className="cursor-pointer font-display text-lg font-semibold">
            Your application
          </summary>
          <dl className="mt-3 space-y-3 text-sm">
            {Object.entries(a.answers).map(([k, v]) => (
              <div key={k}>
                <dt className="text-ink-soft">{labels.get(k) ?? k}</dt>
                <dd className="mt-0.5 whitespace-pre-line font-medium">
                  <LinkifyText value={v} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {a.status === 'active' && (
        <details className="mt-10 text-sm text-ink-soft">
          <summary className="cursor-pointer">No longer interested?</summary>
          <form method="post" action={`/c/${token}/withdraw`} className="mt-3">
            <p className="mb-2">
              This withdraws your application for {a.title} and cancels any booked interview.
              It cannot be undone from this page.
            </p>
            <button className="btn-quiet text-rust">Withdraw my application</button>
          </form>
        </details>
      )}
    </main>
  );
}

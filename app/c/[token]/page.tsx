import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { daysUntil, fmtDay, fmtSlot, fmtTime, gcalUrl } from '@/lib/tz';
import { TASK_MAX_BYTES, TASK_TYPE_HELP } from '@/lib/uploads';
import { allFields, type FormSchema } from '@/lib/form-schema';
import { ORG_NAME } from '@/lib/email';
import LinkifyText from '@/components/LinkifyText';
import TaskSubmitForm from '@/components/TaskSubmitForm';
import Toaster from '@/components/Toaster';
import PostForm from '@/components/PostForm';
import CandidateStepper from '@/components/CandidateStepper';
import CandidateFooter from '@/components/CandidateFooter';
import { directUploads } from '@/lib/storage';
import { briefLinks, FALLBACK_REQUIREMENT, parseSubmissionFields } from '@/lib/brief';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Your application · ${ORG_NAME}`,
  robots: { index: false, follow: false },
};

const STATUS_TEXT: Record<string, string> = {
  hired: 'You got the role — congratulations! Our team will contact you with next steps.',
  rejected: 'Thanks for your interest. We are not moving forward with your application this time.',
  withdrawn: 'This application has been withdrawn.',
};

const OK_TEXT: Record<string, string> = {
  task: 'Submission received — thank you! A confirmation email is on its way.',
  response: 'Response saved — thank you!',
  booked: 'Interview scheduled! Your slot is confirmed and a confirmation email is on its way.',
  cancelled: 'Booking cancelled.',
  withdrawn: 'Your application has been withdrawn.',
};

const ERROR_TEXT: Record<string, string> = {
  taken: 'That slot was just taken — pick another one.',
  file: `Submission failed — check what the task asks for: a file (${TASK_TYPE_HELP}) and/or a valid link starting with http.`,
  required: 'A required item is missing — attach every item marked "required" before submitting.',
  link: 'That link is not valid — it must start with http:// or https://.',
  type: `That file type is not accepted. ${TASK_TYPE_HELP}`,
  size: `A file is too large — the maximum is ${Math.round(TASK_MAX_BYTES / 1048576)} MB per file. Zip or compress it and try again.`,
  ratelimit: 'Too many attempts — wait a few minutes and try again.',
  nothing: 'Nothing new to submit — attach at least one file or link.',
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
  searchParams: Promise<{ e?: string; ok?: string }>;
}) {
  const { token } = await params;
  const { e: errorCode, ok: okCode } = await searchParams;
  const {
    rows: [a],
  } = await q<{
    id: number;
    name: string;
    status: string;
    title: string;
    opening_id: number;
    rejection_pending: boolean;
    stage_id: number | null;
    stage_kind: string | null;
    stage_brief: string | null;
    stage_brief_file: string | null;
    stage_brief_links: string | null;
    submission_fields: unknown;
    deadline: Date | null;
    answers: Record<string, unknown>;
    schema: FormSchema;
    created_at: Date;
  }>(
    `select a.id, a.name, a.status, o.title, o.id as opening_id, s.id as stage_id, s.kind as stage_kind,
            (a.status = 'rejected' and exists (
              select 1 from public.email_log e
              where e.application_id = a.id and e.template = 'rejection' and e.status = 'draft'
            )) as rejection_pending,
            s.brief as stage_brief, s.brief_file_path as stage_brief_file,
            s.brief_links as stage_brief_links, s.submission_fields,
            case when s.task_days > 0 then
              coalesce((select max(h.created_at) from public.stage_history h
                         where h.application_id = a.id and h.to_stage_id = s.id), a.created_at)
              + make_interval(days => s.task_days)
            end as deadline,
            a.answers, f.schema, a.created_at
     from public.applications a
     join public.openings o on o.id = a.opening_id
     join public.forms f on f.id = a.form_id
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1`,
    [token]
  );
  if (!a) notFound();
  const labels = new Map(allFields(a.schema).map((f) => [f.id, f.label || f.id]));
  // staff drafted the rejection but haven't sent it: the portal must not break the news first
  const shownStatus = a.rejection_pending ? 'active' : a.status;

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
        await q<{
          id: number;
          title: string;
          field_id: string;
          file_path: string;
          file_name: string;
          link_url: string;
          note: string;
          created_at: Date;
        }>(
          `select id, title, field_id, file_path, file_name, link_url, note, created_at from public.submissions
           where application_id = $1 and stage_id = $2 order by id desc`,
          [a.id, a.stage_id]
        )
      ).rows
    : [];

  const taskResponse = showTask
    ? (
        await q<{ response: string }>(
          `select response from public.task_responses
           where application_id = $1 and stage_id = $2 order by id desc limit 1`,
          [a.id, a.stage_id]
        )
      ).rows[0]?.response ?? null
    : null;

  const taskLinks = showTask ? briefLinks(a.stage_brief_links) : [];
  const parsedReqs = showTask ? parseSubmissionFields(a.submission_fields) : [];
  // staff defined nothing to hand in → still give the candidate one way to submit
  const requirements = showTask && parsedReqs.length === 0 ? [FALLBACK_REQUIREMENT] : parsedReqs;
  // newest submission per requirement (rows arrive newest-first)
  const doneByField = new Map<string, Date>();
  for (const s of submissions) {
    if (s.field_id && !doneByField.has(s.field_id)) doneByField.set(s.field_id, s.created_at);
  }
  const fmt = fmtSlot;
  const canCancel = booking && booking.starts_at.getTime() - Date.now() > 24 * 3600_000;
  const interviewPast = booking && booking.starts_at.getTime() + booking.duration_mins * 60_000 < Date.now();
  const daysLeft = a.deadline ? daysUntil(a.deadline) : null;
  const overdue = daysLeft !== null && daysLeft < 0;
  const slotsByDay = new Map<string, typeof openSlots>();
  for (const s of openSlots) {
    const day = fmtDay(s.starts_at);
    slotsByDay.set(day, [...(slotsByDay.get(day) ?? []), s]);
  }
  const gcal = (starts: Date, mins: number, link: string) =>
    gcalUrl({
      title: `Interview — ${a.title} (${ORG_NAME})`,
      startsAt: starts,
      durationMins: mins,
      details: link ? `Join: ${link}` : undefined,
      location: link || undefined,
    });
  const otherRoles = (
    <p className="mt-2 text-sm">
      <Link href="/careers" className="text-pine underline">See other open roles →</Link>
    </p>
  );

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-pine">{ORG_NAME} · {a.title}</p>
      <h1 className="track mt-2 font-display text-3xl font-bold">Hi {a.name.split(' ')[0]}</h1>

      <CandidateStepper
        openingId={a.opening_id}
        currentStageId={a.stage_id}
        status={a.status}
        hideOutcome={a.rejection_pending}
      />

      <p className="mt-6 text-lg">
        {STATUS_TEXT[shownStatus] ?? KIND_TEXT[a.stage_kind ?? 'screen'] ?? 'Your application is in review.'}
      </p>
      {(shownStatus === 'rejected' || shownStatus === 'withdrawn') && otherRoles}
      <p className="mt-1 text-sm text-ink-soft">Applied {fmtDay(a.created_at)}</p>

      <Toaster
        initial={
          okCode && OK_TEXT[okCode]
            ? {
                kind: 'success',
                message:
                  okCode === 'cancelled' && openSlots.length > 0
                    ? 'Booking cancelled. You can pick a new slot below.'
                    : okCode === 'cancelled'
                      ? 'Booking cancelled. There are no open slots right now — we\'ll be in touch to reschedule.'
                      : OK_TEXT[okCode],
              }
            : errorCode && ERROR_TEXT[errorCode]
              ? { kind: 'error', message: ERROR_TEXT[errorCode] }
              : null
        }
        cleanParams={['ok', 'e']}
      />

      {showInterview && booking && interviewPast && (
        <div className="mt-8 rounded-lg border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Your interview</h2>
          <p className="mt-2 text-sm">
            Your interview took place on {fmt(booking.starts_at)} — thanks for your time. We&apos;ll be in touch
            with the outcome.
          </p>
        </div>
      )}

      {showInterview && booking && !interviewPast && (
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
          <p className="mt-2 text-sm">
            <a
              href={gcal(booking.starts_at, booking.duration_mins, booking.meeting_link)}
              target="_blank"
              rel="noopener"
              className="text-pine underline"
            >
              Add to Google Calendar
            </a>
          </p>
          {a.stage_brief && (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-soft"><LinkifyText value={a.stage_brief} /></p>
          )}
          {canCancel ? (
            <PostForm
              pendingText="Cancelling…"
              confirmText="Cancel this interview booking? Your slot will be released and you'll need to pick another one."
              method="post"
              action={`/c/${token}/cancel`}
              className="mt-4"
            >
              <button className="btn-quiet min-h-11 text-rust">Cancel booking</button>
              <span className="ml-2 text-xs text-ink-soft">You can pick another slot after cancelling, if any are open.</span>
            </PostForm>
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
          {a.stage_brief && (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-soft"><LinkifyText value={a.stage_brief} /></p>
          )}
          {openSlots.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No open slots right now. New times appear here as soon as the team adds them — check back
              in a day or two, or reply to any of our emails if nothing shows up.
            </p>
          ) : (
            <PostForm
              pendingText="Booking…"
              submitToast="Booking your slot…"
              method="post"
              action={`/c/${token}/book`}
              className="mt-4"
            >
              {[...slotsByDay].map(([day, slots]) => (
                <fieldset key={day} className="mt-3 first:mt-0">
                  <legend className="mb-1.5 text-sm font-medium">{day}</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {slots.map((s) => (
                      <label
                        key={s.id}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm transition-colors hover:bg-pine-wash has-[:checked]:border-pine has-[:checked]:bg-pine-wash has-[:checked]:font-medium"
                      >
                        <input type="radio" name="slotId" value={s.id} required className="accent-pine" />
                        {fmtTime(s.starts_at)} · {s.duration_mins} min
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <p className="mt-3 text-xs text-ink-soft">
                Pick a time, then confirm. You&apos;ll get a confirmation email with a calendar invite.
              </p>
              <button className="btn-primary mt-3 min-h-11">Confirm this slot</button>
            </PostForm>
          )}
        </div>
      )}

      {showTask && (
        <div className="mt-8 rounded-lg border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Your task</h2>
          {a.deadline && daysLeft !== null && (
            <p className={`mt-2 text-sm font-medium ${overdue ? 'text-rust' : 'text-pine-deep'}`}>
              {overdue
                ? `Overdue since ${fmtDay(a.deadline)}`
                : `Deadline: ${fmtDay(a.deadline)} (${daysLeft === 0 ? 'due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`})`}
              <span className="ml-1 font-normal text-ink-soft">
                — {overdue ? 'you can still submit, but late work may not be reviewed.' : 'late work may not be reviewed.'}
              </span>
            </p>
          )}
          <p className="mt-2 whitespace-pre-line text-sm">
            <LinkifyText value={a.stage_brief || 'Task details will be shared with you by email.'} />
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
              <a href={`/c/${token}/brief`} className="btn-quiet inline-flex min-h-11">
                Download task brief document
              </a>
            </p>
          )}

          <div className="mt-5 rounded-md border-2 border-pine bg-pine-wash p-4">
            <h3 className="font-display font-semibold">Are you doing this task?</h3>
            {taskResponse === null ? (
              <PostForm
                pendingText="Saving…"
                method="post"
                action={`/c/${token}/task-response`}
                className="mt-3 flex flex-wrap gap-3"
              >
                <button name="response" value="yes" className="btn-primary min-h-11">Yes, I&apos;m on it</button>
                <button name="response" value="no" className="btn-quiet min-h-11 text-rust">No, I&apos;m not</button>
              </PostForm>
            ) : (
              <>
                <p className="mt-2 text-sm">
                  {taskResponse === 'yes' ? (
                    <>You answered <strong className="text-pine-deep">✓ Yes</strong> — great, we&apos;ll look out for your submission.</>
                  ) : (
                    <>You answered <strong className="text-rust">✕ No</strong>. Thanks for letting us know.</>
                  )}
                </p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-pine underline">Change response</summary>
                  <PostForm
                    pendingText="Saving…"
                    method="post"
                    action={`/c/${token}/task-response`}
                    className="mt-3 flex flex-wrap gap-3"
                  >
                    <button name="response" value="yes" className="btn-primary min-h-11">Yes, I&apos;m on it</button>
                    <button name="response" value="no" className="btn-quiet min-h-11 text-rust">No, I&apos;m not</button>
                  </PostForm>
                </details>
              </>
            )}
          </div>

          {submissions.length > 0 && (
            <div className="mt-4 rounded-md bg-pine-wash px-3 py-2 text-sm text-pine-deep">
              <p className="font-medium">Your submissions</p>
              <ul className="mt-1 space-y-1.5">
                {submissions.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.title || 'Submission'}</span>
                    <span className="opacity-70"> · {fmt(s.created_at)}</span>
                    <div className="break-all text-xs">
                      {s.file_path && <span>File: {s.file_name || 'uploaded file'}</span>}
                      {s.file_path && s.link_url && ' · '}
                      {s.link_url && (
                        <a href={s.link_url} target="_blank" rel="noopener noreferrer" className="underline">
                          {s.link_url}
                        </a>
                      )}
                    </div>
                    {s.note && <div className="text-xs opacity-80">Note: {s.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {taskResponse === 'no' ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-pine underline">Changed your mind? Submit your work anyway</summary>
              <TaskSubmitForm
                action={`/c/${token}/task`}
                signUrl={`/c/${token}/upload-url`}
                direct={directUploads}
                maxBytes={TASK_MAX_BYTES}
                requirements={requirements.map((r) => {
                  const done = doneByField.get(r.id);
                  return { ...r, done: done ? fmt(done) : null };
                })}
              />
            </details>
          ) : (
            <TaskSubmitForm
              action={`/c/${token}/task`}
              signUrl={`/c/${token}/upload-url`}
              direct={directUploads}
              maxBytes={TASK_MAX_BYTES}
              requirements={requirements.map((r) => {
                const done = doneByField.get(r.id);
                return { ...r, done: done ? fmt(done) : null };
              })}
            />
          )}
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
          <PostForm
            pendingText="Withdrawing…"
            confirmText={`Withdraw your application for ${a.title}? This cancels any booked interview and cannot be undone from this page.`}
            method="post"
            action={`/c/${token}/withdraw`}
            className="mt-3"
          >
            <p className="mb-2">
              This withdraws your application for {a.title} and cancels any booked interview.
              It cannot be undone from this page — we&apos;ll email you a confirmation.
            </p>
            <button className="btn-quiet min-h-11 text-rust">Withdraw my application</button>
          </PostForm>
        </details>
      )}
      <CandidateFooter />
    </main>
  );
}

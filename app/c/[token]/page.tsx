import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { daysUntil, fmtDate, fmtDay, fmtSlot, fmtTime, gcalUrl } from '@/lib/tz';
import { TASK_MAX_BYTES, TASK_TYPE_HELP } from '@/lib/uploads';
import { allFields, type FormSchema } from '@/lib/form-schema';
import { ORG_NAME } from '@/lib/email';
import LinkifyText from '@/components/LinkifyText';
import TaskSubmitForm from '@/components/TaskSubmitForm';
import Toaster from '@/components/Toaster';
import PostForm from '@/components/PostForm';
import CandidateStepper from '@/components/CandidateStepper';
import CandidateFooter from '@/components/CandidateFooter';
import CancelBookingDialog from '@/components/CancelBookingDialog';
import { canChangeBooking } from '@/lib/reschedule';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { directUploads } from '@/lib/storage';
import { briefLinks, FALLBACK_REQUIREMENT, parseSubmissionFields } from '@/lib/brief';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
  rebooked: 'Interview moved! Your new slot is confirmed and a confirmation email is on its way.',
  requested: 'Request sent. Your current slot stays booked until the team decides — we\'ll email you either way.',
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
  late: 'The interview is less than an hour away, so it can no longer be changed here.',
  pending: 'You already have a reschedule request awaiting a decision.',
  time: 'Pick a date and time at least an hour from now.',
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
        await q<{ id: number; starts_at: Date; duration_mins: number; meeting_link: string; completed_at: Date | null }>(
          `select id, starts_at, duration_mins, meeting_link, completed_at from public.slots
           where application_id = $1 and stage_id = $2`,
          [a.id, a.stage_id]
        )
      ).rows[0]
    : undefined;

  // latest reschedule request for this stage: pending shows as such; rejected shows while the booking it referred to stands
  const request = booking
    ? (
        await q<{ id: number; slot_id: number | null; requested_at: Date; status: string; decision_note: string }>(
          `select id, slot_id, requested_at, status, decision_note from public.reschedule_requests
           where application_id = $1 and stage_id = $2 order by id desc limit 1`,
          [a.id, a.stage_id]
        )
      ).rows[0]
    : undefined;
  const pendingRequest = request?.status === 'pending' ? request : undefined;
  const rejectedRequest = request?.status === 'rejected' && Number(request.slot_id) === Number(booking?.id) ? request : undefined;
  const interviewPast = booking && (booking.completed_at != null || booking.starts_at.getTime() + booking.duration_mins * 60_000 < Date.now());
  const canChange = !!booking && !interviewPast && canChangeBooking(booking.starts_at);

  const openSlots =
    showInterview && (!booking || canChange)
      ? (
          await q<{ id: number; starts_at: Date; duration_mins: number }>(
            `select id, starts_at, duration_mins from public.slots
             where stage_id = $1 and application_id is null and starts_at > now() and id <> coalesce($2::bigint, 0)
             order by starts_at limit 40`,
            [a.stage_id, booking?.id ?? null]
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
  const daysLeft = a.deadline ? daysUntil(a.deadline) : null;
  const overdue = daysLeft !== null && daysLeft < 0;
  const slotsByDay = new Map<string, typeof openSlots>();
  for (const s of openSlots) {
    const day = fmtDay(s.starts_at);
    slotsByDay.set(day, [...(slotsByDay.get(day) ?? []), s]);
  }
  const today = fmtDate(new Date());
  const slotPicker = () =>
    [...slotsByDay].map(([day, slots]) => (
      <fieldset key={day} className="mt-3 first:mt-0">
        <legend className="mb-1.5 text-sm font-medium">{day}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slots.map((s) => (
            <label
              key={s.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:font-medium"
            >
              <input type="radio" name="slotId" value={s.id} required />
              {fmtTime(s.starts_at)} · {s.duration_mins} min
            </label>
          ))}
        </div>
      </fieldset>
    ));
  const gcal = (starts: Date, mins: number, link: string) =>
    gcalUrl({
      title: `Interview — ${a.title} (${ORG_NAME})`,
      startsAt: starts,
      durationMins: mins,
      details: link ? `Join: ${link}` : undefined,
      location: link || undefined,
    });
  const outcome = STATUS_TEXT[shownStatus];

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-primary">{ORG_NAME} · {a.title}</p>
      <h1 className="track mt-2 font-display text-3xl font-bold">Hi {a.name.split(' ')[0]}</h1>

      <CandidateStepper
        openingId={a.opening_id}
        currentStageId={a.stage_id}
        status={a.status}
        hideOutcome={a.rejection_pending}
      />

      {outcome ? (
        <Alert className={`mt-6 ${shownStatus === 'hired' ? 'border-primary bg-secondary' : ''}`}>
          <AlertTitle className="text-base">{outcome}</AlertTitle>
          {(shownStatus === 'rejected' || shownStatus === 'withdrawn') && (
            <AlertDescription>
              <Link href="/careers">See other open roles →</Link>
            </AlertDescription>
          )}
        </Alert>
      ) : (
        <p className="mt-6 text-lg">
          {KIND_TEXT[a.stage_kind ?? 'screen'] ?? 'Your application is in review.'}
        </p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">Applied {fmtDay(a.created_at)}</p>

      <Toaster
        initial={
          okCode && OK_TEXT[okCode]
            ? {
                kind: 'success',
                message: OK_TEXT[okCode],
              }
            : errorCode && ERROR_TEXT[errorCode]
              ? { kind: 'error', message: ERROR_TEXT[errorCode] }
              : null
        }
        cleanParams={['ok', 'e']}
      />

      {showInterview && booking && interviewPast && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-display text-lg font-semibold">
              <h2>Your interview</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {booking.completed_at
              ? <>Your interview on {fmt(booking.starts_at)} is complete — thanks for your time. The team is reviewing the round and will be in touch with the outcome.</>
              : <>Your interview took place on {fmt(booking.starts_at)} — thanks for your time. We&apos;ll be in touch with the outcome.</>}
          </CardContent>
        </Card>
      )}

      {showInterview && booking && !interviewPast && (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="text-sm font-medium text-muted-foreground">Your interview</h2>
            <CardTitle className="font-display text-lg font-semibold text-primary">
              {fmt(booking.starts_at)} · {booking.duration_mins} min
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {booking.meeting_link &&
                (/^https?:\/\//.test(booking.meeting_link) ? (
                  <a href={booking.meeting_link} className={buttonVariants({ size: 'lg' })} target="_blank" rel="noopener">
                    Join the meeting
                  </a>
                ) : (
                  <span className="text-sm">Location: {booking.meeting_link}</span>
                ))}
              <a
                href={gcal(booking.starts_at, booking.duration_mins, booking.meeting_link)}
                target="_blank"
                rel="noopener"
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                Add to Google Calendar
              </a>
            </div>
            {a.stage_brief && (
              <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground"><LinkifyText value={a.stage_brief} /></p>
            )}
            {pendingRequest && (
              <Alert className="mt-4">
                <AlertTitle>Reschedule requested for {fmt(pendingRequest.requested_at)}</AlertTitle>
                <AlertDescription>
                  Awaiting the team&apos;s decision. Until then this interview still stands — please keep the time
                  free. We&apos;ll email you either way.
                </AlertDescription>
              </Alert>
            )}
            {rejectedRequest && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Your request for {fmt(rejectedRequest.requested_at)} couldn&apos;t be accommodated.</AlertTitle>
                <AlertDescription>
                  {rejectedRequest.decision_note || 'Your interview remains at the time above.'}
                  {canChange && openSlots.length > 0 ? ' You can still pick another open slot below.' : ''}
                </AlertDescription>
              </Alert>
            )}
            {canChange ? (
              <div id="reschedule" className="mt-5 space-y-3 border-t border-border pt-4">
                <p className="text-sm font-medium">Need to change this interview?</p>
                {openSlots.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-primary underline">Pick another open slot</summary>
                    <PostForm pendingText="Moving…" submitToast="Moving your interview…" method="post" action={`/c/${token}/rebook`} className="mt-3">
                      {slotPicker()}
                      <Button type="submit" size="lg" className="mt-3">Move to this slot</Button>
                    </PostForm>
                  </details>
                )}
                {!pendingRequest && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-primary underline">
                      {openSlots.length > 0 ? 'None of these work? Request another day or time' : 'Request another day or time'}
                    </summary>
                    <PostForm pendingText="Sending…" method="post" action={`/c/${token}/reschedule`} className="mt-3 space-y-3">
                      <p className="text-muted-foreground">
                        Tell us when you can make it. The team will confirm or suggest an alternative — your current
                        slot stays booked until then.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="rs-date">Date</Label>
                          <Input id="rs-date" type="date" name="date" min={today} required />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="rs-time">Time (IST)</Label>
                          <Input id="rs-time" type="time" name="time" required />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="rs-note">Reason (optional)</Label>
                        <Textarea id="rs-note" name="note" rows={2} maxLength={1000} placeholder="e.g. I have an exam that afternoon." />
                      </div>
                      <Button type="submit" size="lg">Send request</Button>
                    </PostForm>
                  </details>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <CancelBookingDialog role={a.title} withdrawAction={`/c/${token}/withdraw`} />
                  <span className="text-xs text-muted-foreground">Changes are possible up to 1 hour before the interview.</span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                This interview is less than an hour away, so it can no longer be changed here. If you can&apos;t
                attend, reply to your confirmation email.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {showInterview && !booking && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-display text-lg font-semibold">
              <h2>Pick an interview slot</h2>
            </CardTitle>
            {a.stage_brief && (
              <CardDescription className="whitespace-pre-line"><LinkifyText value={a.stage_brief} /></CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {openSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open slots right now. New times appear here as soon as the team adds them — check back
                in a day or two, or reply to any of our emails if nothing shows up.
              </p>
            ) : (
              <PostForm
                pendingText="Booking…"
                submitToast="Booking your slot…"
                method="post"
                action={`/c/${token}/book`}
              >
                {slotPicker()}
                <p className="mt-3 text-xs text-muted-foreground">
                  Pick a time, then confirm. You&apos;ll get a confirmation email with a calendar invite.
                </p>
                <Button type="submit" size="lg" className="mt-3">Confirm this slot</Button>
              </PostForm>
            )}
          </CardContent>
        </Card>
      )}

      {showTask && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-display text-lg font-semibold">
              <h2>Your task</h2>
            </CardTitle>
            {a.deadline && daysLeft !== null && (
              <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant={overdue ? 'destructive' : 'secondary'}>
                  {overdue
                    ? `Overdue since ${fmtDay(a.deadline)}`
                    : `Deadline: ${fmtDay(a.deadline)} (${daysLeft === 0 ? 'due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`})`}
                </Badge>
                <span>{overdue ? 'You can still submit, but late work may not be reviewed.' : 'Late work may not be reviewed.'}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm">
              <LinkifyText value={a.stage_brief || 'Task details will be shared with you by email.'} />
            </p>
            {taskLinks.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {taskLinks.map((l) => (
                  <li key={l}>
                    <a href={l} target="_blank" rel="noopener" className="break-all text-primary underline">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {a.stage_brief_file && (
              <p className="mt-3">
                <a href={`/c/${token}/brief`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  Download task brief document
                </a>
              </p>
            )}

            <div className="mt-5 rounded-lg border-2 border-primary bg-secondary p-4">
              <h3 className="font-display font-semibold">Are you doing this task?</h3>
              {taskResponse === null ? (
                <PostForm
                  pendingText="Saving…"
                  method="post"
                  action={`/c/${token}/task-response`}
                  className="mt-3 flex flex-wrap gap-3"
                >
                  <Button type="submit" name="response" value="yes" size="lg">Yes, I&apos;m on it</Button>
                  <Button type="submit" name="response" value="no" variant="outline" size="lg">No, I&apos;m not</Button>
                </PostForm>
              ) : (
                <>
                  <p className="mt-2 text-sm">
                    {taskResponse === 'yes' ? (
                      <>You answered <strong className="text-primary">✓ Yes</strong> — great, we&apos;ll look out for your submission.</>
                    ) : (
                      <>You answered <strong className="text-destructive">✕ No</strong>. Thanks for letting us know.</>
                    )}
                  </p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-primary underline">Change response</summary>
                    <PostForm
                      pendingText="Saving…"
                      method="post"
                      action={`/c/${token}/task-response`}
                      className="mt-3 flex flex-wrap gap-3"
                    >
                      <Button type="submit" name="response" value="yes" size="lg">Yes, I&apos;m on it</Button>
                      <Button type="submit" name="response" value="no" variant="outline" size="lg">No, I&apos;m not</Button>
                    </PostForm>
                  </details>
                </>
              )}
            </div>

            {submissions.length > 0 && (
              <div className="mt-4 text-sm">
                <p className="font-medium">Your submissions</p>
                <ul className="mt-1 space-y-2">
                  {submissions.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.title || 'Submission'}</span>
                      <span className="text-muted-foreground"> · {fmt(s.created_at)}</span>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-all text-xs">
                        {s.file_path && (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline">File</Badge>
                            {s.file_name || 'uploaded file'}
                          </span>
                        )}
                        {s.link_url && (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline">Link</Badge>
                            <a href={s.link_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                              {s.link_url}
                            </a>
                          </span>
                        )}
                      </div>
                      {s.note && <div className="text-xs text-muted-foreground">Note: {s.note}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {taskResponse === 'no' ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-primary underline">Changed your mind? Submit your work anyway</summary>
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
          </CardContent>
        </Card>
      )}

      {Object.keys(a.answers).length > 0 && (
        <Card className="mt-8">
          <details>
            <summary className="cursor-pointer px-(--card-spacing) font-display text-lg font-semibold">
              <h2 className="inline">Your application</h2>
            </summary>
            <CardContent>
              <dl className="mt-3 space-y-3 text-sm">
                {Object.entries(a.answers).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{labels.get(k) ?? k}</dt>
                    <dd className="mt-0.5 whitespace-pre-line font-medium">
                      <LinkifyText value={v} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </details>
        </Card>
      )}

      {a.status === 'active' && (
        <Card className="mt-10">
          <details>
            <summary className="cursor-pointer px-(--card-spacing) text-sm text-muted-foreground">
              <h2 className="inline font-medium">No longer interested?</h2>
            </summary>
            <CardContent>
              <PostForm
                pendingText="Withdrawing…"
                confirmText={`Withdraw your application for ${a.title}? This cancels any booked interview and cannot be undone from this page.`}
                method="post"
                action={`/c/${token}/withdraw`}
                className="mt-3 text-sm text-muted-foreground"
              >
                <p className="mb-3">
                  This withdraws your application for {a.title} and cancels any booked interview.
                  It cannot be undone from this page — we&apos;ll email you a confirmation.
                </p>
                <Button type="submit" variant="destructive" size="lg">Withdraw my application</Button>
              </PostForm>
            </CardContent>
          </details>
        </Card>
      )}
      <CandidateFooter />
    </main>
  );
}

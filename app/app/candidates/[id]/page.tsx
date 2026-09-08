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
import StarRating from '@/components/StarRating';
import Flash from '@/components/Flash';
import { FEEDBACK_JOIN, PIPELINE_SORTS, PIPELINE_WHERE, pipelineWhereParams, type PipelineCtx } from '@/lib/pipeline';
import {
  addFeedback,
  addNote,
  bulkPipeline,
  completeInterview,
  composeEmail,
  reopenInterview,
  resendEmail,
  staffBookSlot,
  staffCancelSlot,
  updateCandidate,
  updateTags,
} from '../actions';
import { pipelineFlash } from '../flash';
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [a],
  } = await q<{ name: string }>('select name from public.applications where id = $1', [Number(id)]);
  return { title: a ? a.name : 'Candidate' };
}

type BadgeStyle = { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string };
const AMBER: BadgeStyle = { variant: 'outline', className: 'border-transparent bg-amber/15 text-amber' };
const EMAIL_STATUS_BADGE: Record<string, BadgeStyle> = {
  draft: AMBER,
  sent: { variant: 'secondary' },
  pending: AMBER,
  failed: { variant: 'destructive' },
  cancelled: { variant: 'outline' },
};

const STATUS_BADGE: Record<string, BadgeStyle> = {
  active: { variant: 'secondary' },
  hired: { variant: 'default' },
  rejected: { variant: 'destructive' },
  withdrawn: { variant: 'outline' },
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

  const [{ rows: stages }, { rows: history }, { rows: feedback }, { rows: notes }, { rows: subs }, { rows: slots }, { rows: emails }, { rows: taskStages }, { rows: responses }, { rows: reached }] =
    await Promise.all([
      q<{ id: number; name: string; kind: string }>(
        `select id, name, kind from public.stages where opening_id = $1 order by position`,
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
      q<{ id: number; stage_id: number; starts_at: Date; duration_mins: number; stage: string; interviewer: string; completed_at: Date | null }>(
        `select sl.id, sl.stage_id, sl.starts_at, sl.duration_mins, st.name as stage, p.full_name as interviewer, sl.completed_at
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
      q<{ stage_id: number }>(
        `select distinct to_stage_id as stage_id from public.stage_history where application_id = $1 and to_stage_id is not null
         union select stage_id from public.submissions where application_id = $1 and stage_id is not null`,
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

  // one feedback form per stage that can be scored: task stages reached, interview
  // stages with a booking, plus the current stage if it is neither
  const reachedIds = new Set([...reached.map((r) => Number(r.stage_id)), ...(a.current_stage_id ? [Number(a.current_stage_id)] : [])]);
  const bookedStageIds = new Set(slots.map((s) => Number(s.stage_id)));
  const scoreForms = stages
    .filter((s) => (s.kind === 'task' && reachedIds.has(Number(s.id))) || (s.kind === 'interview' && bookedStageIds.has(Number(s.id))))
    .map((s) => ({ id: Number(s.id), name: s.name, kind: s.kind, title: s.kind === 'task' ? `Task score · ${s.name}` : `Interview feedback · ${s.name}` }));
  const cur = stages.find((s) => Number(s.id) === Number(a.current_stage_id));
  if (cur && !scoreForms.some((f) => f.id === Number(cur.id))) {
    scoreForms.push({ id: Number(cur.id), name: cur.name, kind: cur.kind, title: `Feedback · ${cur.name}` });
  }
  const mine = (stageId: number) => feedback.find((f) => f.author_id === user.id && Number(f.stage_id) === stageId);
  const latestFor = (kind: string) =>
    feedback.find((f) => f.rating && stages.some((s) => Number(s.id) === Number(f.stage_id) && s.kind === kind));
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
    stage: 'bg-primary',
    email: 'bg-amber',
    response: 'bg-amber',
    feedback: 'bg-muted-foreground',
    note: 'bg-border',
    submission: 'bg-primary',
    interview: 'bg-secondary border border-primary',
  };

  const navArrow = (id: number | undefined, label: string, dir: 'prev' | 'next') => {
    const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
    const inner = dir === 'prev' ? (<><Icon data-icon="inline-start" />{label}</>) : (<>{label}<Icon data-icon="inline-end" /></>);
    return id ? (
      <Link href={`/app/candidates/${id}?${navQs}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {inner}
      </Link>
    ) : (
      <span aria-disabled className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-40')}>{inner}</span>
    );
  };

  const flash = pipelineFlash(ok, err);
  return (
    <div>
      <Flash kind={flash?.kind ?? 'success'} message={flash?.message} />
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/candidates" />
        {nav && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            {navArrow(nav.prev, 'Prev', 'prev')}
            <span className="text-muted-foreground">
              {nav.pos} of {nav.total}
            </span>
            {navArrow(nav.next, 'Next', 'next')}
          </div>
        )}
      </div>
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
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
          <Badge variant={STATUS_BADGE[a.status]?.variant ?? 'outline'} className={cn('h-6 px-3 text-sm', STATUS_BADGE[a.status]?.className)}>
            {a.status}
          </Badge>
          {a.score != null && (
            <Badge variant="outline" className="h-6 border-transparent bg-amber/15 px-3 text-sm text-amber">
              score {a.score}
              {Number(a.max_score) > 0 && ` / ${a.max_score}`}
            </Badge>
          )}
          {latestFor('task') && (
            <Badge variant="outline" className="h-6 px-3 text-sm" title="Latest task score">
              task <span className="ml-1 text-amber">{'★'.repeat(latestFor('task')!.rating!)}</span>
            </Badge>
          )}
          {latestFor('interview') && (
            <Badge variant="outline" className="h-6 px-3 text-sm" title="Latest interview feedback">
              interview <span className="ml-1 text-amber">{'★'.repeat(latestFor('interview')!.rating!)}</span>
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>{a.email}</span>
        {a.phone && <span>{a.phone}</span>}
        <span>applied {fmtDate(a.created_at)}</span>
        {source && <span title="Ad source">via {source}</span>}
        {a.resume_path && (
          <a href={`/api/files/${a.resume_path}`} target="_blank" className="text-primary underline">
            Resume
          </a>
        )}
        <a
          href={portalUrl(a.portal_token)}
          target="_blank"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-primary')}
          title="The candidate's private status page — where they track progress, book interviews, and submit tasks. Share this link if they lose their email."
        >
          Candidate portal
          <ExternalLink data-icon="inline-end" />
        </a>
        <details className="basis-full">
          <summary className="cursor-pointer text-primary hover:underline">Edit details</summary>
          <form action={updateCandidate} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="applicationId" value={a.id} />
            <Field className="min-w-40 flex-1">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" name="name" required defaultValue={a.name}  />
            </Field>
            <Field className="min-w-48 flex-1">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" name="email" type="email" required defaultValue={a.email}  />
            </Field>
            <Field className="w-40">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input id="edit-phone" name="phone" defaultValue={a.phone}  />
            </Field>
            <SubmitButton variant="outline" pendingLabel="Saving…">Save details</SubmitButton>
          </form>
        </details>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {a.tags.map((t) => (
          <form key={t} action={updateTags}>
            <input type="hidden" name="applicationId" value={a.id} />
            <input type="hidden" name="remove" value={t} />
            <button
              className={cn(badgeVariants({ variant: 'secondary' }), 'cursor-pointer hover:bg-destructive/10 hover:text-destructive')}
              title="Remove tag"
            >
              {t} ✕
            </button>
          </form>
        ))}
        <form action={updateTags} className="flex items-center gap-1">
          <input type="hidden" name="applicationId" value={a.id} />
          <Input name="add" aria-label="New tag" placeholder="+ tag" className="h-6 w-28 px-2 text-xs" />
          <SubmitButton variant="outline" size="xs" pendingLabel="…">Add</SubmitButton>
        </form>
      </div>

      <form action={bulkPipeline} className="mt-6 flex flex-wrap items-center gap-2 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
        <input type="hidden" name="openingId" value={a.opening_id} />
        <input type="hidden" name="appId" value={a.id} />
        <input type="hidden" name="back" value={`${selfHref}?${navQs}`} />
        <label className="sr-only" htmlFor="stageId">Stage to move to</label>
        <NativeSelect className="w-44" id="stageId" name="stageId" size="sm" defaultValue={a.current_stage_id ?? undefined}>
          {stages.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>
          ))}
        </NativeSelect>
        <SubmitButton variant="outline" name="intent" value="move" pendingLabel="Moving…">Move to stage</SubmitButton>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" name="notify" value="1" defaultChecked  />
          Email the candidate about this move
        </label>
        <Separator orientation="vertical" className="mx-2 h-5!" />
        {a.status === 'active' ? (
          <>
            <SubmitButton variant="outline" name="intent" value="hire" className="text-primary" pendingLabel="Hiring…" confirmText={`Mark ${a.name} as hired? They will get the congratulations email.`}>Mark hired</SubmitButton>
            <SubmitButton variant="destructive" name="intent" value="reject_send" pendingLabel="Rejecting…" confirmText={`Reject ${a.name} and email them now?`}>Reject + email now</SubmitButton>
            <SubmitButton variant="destructive" name="intent" value="reject_draft" pendingLabel="Rejecting…" confirmText={`Reject ${a.name}? The email is drafted in Emails for you to send later.`} title="Rejects and drafts the email — send it manually from the Emails tab">Reject + draft email</SubmitButton>
            <SubmitButton variant="outline" name="intent" value="withdraw" pendingLabel="Updating…" confirmText={`Mark ${a.name} as withdrawn? No email is sent.`} title="For candidates who told you they are no longer interested">Mark withdrawn</SubmitButton>
          </>
        ) : (
          <SubmitButton variant="outline" name="intent" value="restore" pendingLabel="Restoring…">Restore to active</SubmitButton>
        )}
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
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
                className="mt-3 h-96 w-full rounded-lg border border-border bg-card"
              />
            </section>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg font-semibold">Application</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {Object.entries(a.answers).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{labels.get(k) ?? k}</dt>
                    <dd className="mt-0.5 whitespace-pre-line font-medium">
                      <LinkifyText value={v} />
                    </dd>
                  </div>
                ))}
                {Object.keys(a.answers).length === 0 && (
                  <p className="text-muted-foreground">No custom questions were on this form.</p>
                )}
              </dl>
            </CardContent>
          </Card>

          <section>
            <h2 className="font-display text-lg font-semibold">Task submissions</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {requirements.map((r) => {
                const rows = subs.filter((s) => s.field_id === r.id);
                return (
                  <li key={r.id} className="rounded-lg border border-border bg-card p-3">
                    <span className="mr-2 font-medium">{r.title}</span>
                    <Badge variant={r.required ? 'destructive' : 'outline'} className="mr-2">
                      {r.required ? 'required' : 'optional'}
                    </Badge>
                    {rows.length === 0 ? (
                      <span className="text-amber">Not submitted yet</span>
                    ) : (
                      rows.map((s, i) => (
                        <span key={s.id} className={i > 0 ? 'mt-1 block pl-4' : ''}>
                          {s.file_path && (
                            <a href={`/api/files/${s.file_path}`} target="_blank" className="font-medium text-primary underline">
                              {s.file_name || 'file'}
                            </a>
                          )}
                          {s.link_url && (
                            <a
                              href={s.link_url}
                              target="_blank"
                              rel="noopener"
                              className={`font-medium text-primary underline ${s.file_path ? 'ml-2' : ''}`}
                            >
                              link ↗
                            </a>
                          )}
                          <span className="ml-2 text-muted-foreground">
                            {i > 0 && 'earlier version · '}
                            {fmt(s.created_at)}
                          </span>
                          {s.note && <span className="ml-2 text-muted-foreground">— {s.note}</span>}
                        </span>
                      ))
                    )}
                  </li>
                );
              })}
              {extraSubs.map((s) => (
                <li key={s.id} className="rounded-lg border border-border bg-card p-3">
                  <span className="mr-2 font-medium">{s.title || 'Submission'}</span>
                  {s.file_path && (
                    <a href={`/api/files/${s.file_path}`} target="_blank" className="font-medium text-primary underline">
                      {s.file_name || 'file'}
                    </a>
                  )}
                  {s.link_url && (
                    <a
                      href={s.link_url}
                      target="_blank"
                      rel="noopener"
                      className={`font-medium text-primary underline ${s.file_path ? 'ml-2' : ''}`}
                    >
                      link ↗
                    </a>
                  )}
                  <span className="ml-2 text-muted-foreground">
                    {s.stage ?? ''} · {fmt(s.created_at)}
                  </span>
                  {s.note && <p className="mt-1 whitespace-pre-line text-muted-foreground">{s.note}</p>}
                </li>
              ))}
              {requirements.length === 0 && subs.length === 0 && (
                <li className="text-muted-foreground">Nothing submitted yet.</li>
              )}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Emails sent</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {emails.map((e) => (
                <li key={e.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 hover:bg-muted/40 group-open:rounded-b-none">
                      <Badge variant={EMAIL_STATUS_BADGE[e.status]?.variant ?? 'outline'} className={EMAIL_STATUS_BADGE[e.status]?.className}>
                        {e.status}
                      </Badge>
                      <span className="font-medium">{e.subject}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.template} · {fmt(e.created_at)}{e.service ? ` · via ${e.service}` : ''}
                      </span>
                    </summary>
                    <div className="rounded-b-lg border border-t-0 bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">to {e.to_email}</p>
                      <p className="mt-1 whitespace-pre-line">{e.body}</p>
                      {e.error && <p className="mt-2 text-destructive">error: {e.error}</p>}
                      {(e.status === 'sent' || e.status === 'failed') && (
                        <form action={resendEmail} className="mt-2">
                          <input type="hidden" name="applicationId" value={a.id} />
                          <input type="hidden" name="emailId" value={e.id} />
                          <SubmitButton variant="outline" size="sm" pendingLabel="Resending…" doneMessage="Email queued — status updates below">
                            Resend this email
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </details>
                </li>
              ))}
              {emails.length === 0 && <li className="text-muted-foreground">No emails sent yet.</li>}
            </ul>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Interviews</h2>
              <Link
                href={`/app/openings/${a.opening_id}/slots`}
                className="text-sm text-primary underline"
              >
                Interview slots →
              </Link>
            </div>
            {noOpenSlots && (
              <Alert variant="destructive" className="mt-3">
                <AlertTriangle />
                <AlertTitle>No open slots for {stageInfo?.name ?? 'this stage'}.</AlertTitle>
                <AlertDescription>
                  {a.name} has the interview invite but nothing to book.{' '}
                  <Link href={`/app/openings/${a.opening_id}/slots`}>Create slots</Link>
                </AlertDescription>
              </Alert>
            )}
            <ul className="mt-3 space-y-2 text-sm">
              {slots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                  <span>
                    <span className="font-medium">{fmt(s.starts_at)}</span>
                    <span className="text-muted-foreground"> · {s.duration_mins}m · {s.stage} · with {s.interviewer}</span>
                    {s.completed_at && <Badge variant="secondary" className="ml-2">Completed</Badge>}
                  </span>
                  <span className="flex items-center gap-2">
                    {!s.completed_at && s.starts_at <= new Date() && (
                      <form action={completeInterview}>
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <SubmitButton size="sm" pendingLabel="Saving…">Mark completed</SubmitButton>
                      </form>
                    )}
                    {s.completed_at && (
                      <form action={reopenInterview}>
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <SubmitButton variant="ghost" size="sm" pendingLabel="Saving…">Reopen</SubmitButton>
                      </form>
                    )}
                    {!s.completed_at && s.starts_at > new Date() && (
                      <form action={staffCancelSlot}>
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <SubmitButton variant="destructive" size="sm" pendingLabel="Cancelling…"
                          confirmText={`Cancel the ${fmt(s.starts_at)} interview? ${a.name} and ${s.interviewer} will be emailed.`}>
                          Cancel interview
                        </SubmitButton>
                      </form>
                    )}
                  </span>
                </li>
              ))}
              {slots.length === 0 && <li className="text-muted-foreground">No interview booked.</li>}
            </ul>
            {openSlots.length > 0 && (
              <form action={staffBookSlot} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="applicationId" value={a.id} />
                <label className="sr-only" htmlFor="slotId">Open slot</label>
                <NativeSelect className="flex-1" id="slotId" name="slotId" size="sm">
                  {openSlots.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {fmt(s.starts_at)} — {s.interviewer}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <SubmitButton variant="outline" pendingLabel="Booking…">Book for candidate</SubmitButton>
                {moreSlots && <span className="basis-full text-xs text-muted-foreground">Showing the first 30 open slots.</span>}
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
                    <span className="text-muted-foreground"> · {fmt(t.at)}{t.extra ? ` · ${t.extra}` : ''}</span>
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
                    <Link href={`/app/candidates/${x.id}`} className="text-primary underline">
                      {x.title}
                    </Link>
                    <span className="text-muted-foreground"> · {x.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-8">
          <section id="feedback">
            <h2 className="font-display text-lg font-semibold">Feedback</h2>
            <div className="mt-3 space-y-4">
              {scoreForms.map((sf) => {
                const my = mine(sf.id);
                const rows = feedback.filter((f) => Number(f.stage_id) === sf.id);
                return (
                  <form key={sf.id} action={addFeedback} className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <input type="hidden" name="stageId" value={sf.id} />
                    <p className="font-medium">{sf.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StarRating label={`${sf.title} rating`} defaultValue={my?.rating ?? null} />
                      <Input
                        name="comment"
                        aria-label={`${sf.title} comment`}
                        placeholder={sf.kind === 'task' ? 'What stood out in the submission…' : sf.kind === 'interview' ? 'How did the interview go…' : 'Your verdict for this stage…'}
                        defaultValue={my?.comment ?? ''}
                        className="min-w-48 flex-1"
                      />
                      <SubmitButton pendingLabel="Saving…" doneMessage={my ? 'Feedback updated' : 'Feedback saved'}>
                        {my ? 'Update' : 'Save'}
                      </SubmitButton>
                    </div>
                    {sf.kind !== 'screen' && sf.kind !== 'offer' && Number(a.current_stage_id) === sf.id && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {sf.kind === 'task'
                          ? 'Saving a star rating moves the candidate to the review stage and emails them.'
                          : 'Once the interview is marked completed and rated, the candidate moves to the review stage and is emailed.'}
                      </p>
                    )}
                    {my && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        You left this on {fmt(my.created_at)} — saving replaces it.
                      </p>
                    )}
                    {rows.length > 0 && (
                      <ul className="mt-3 space-y-2 border-t border-border pt-3">
                        {rows.map((f, i) => (
                          <li key={i} className="flex items-start justify-between gap-3">
                            <span>
                              <span className="font-medium">{f.author}</span>
                              {f.comment && <span className="text-muted-foreground"> — {f.comment}</span>}
                              <span className="block text-xs text-muted-foreground">{fmt(f.created_at)}</span>
                            </span>
                            <span className="shrink-0 text-amber">{f.rating ? '★'.repeat(f.rating) : ''}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </form>
                );
              })}
              {(() => {
                const other = feedback.filter((f) => !scoreForms.some((sf) => sf.id === Number(f.stage_id)));
                return other.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {other.map((f, i) => (
                      <li key={i} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{f.author}</span>
                          <span className="text-amber">{f.rating ? '★'.repeat(f.rating) : ''}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-line">{f.comment}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{f.stage ?? 'General'} · {fmt(f.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()}
              {scoreForms.length === 0 && feedback.length === 0 && (
                <p className="text-sm text-muted-foreground">No feedback yet.</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Email the candidate</h2>
            <form action={composeEmail} className="mt-3 space-y-2 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
              <input type="hidden" name="applicationId" value={a.id} />
              <Input name="subject" required placeholder="Subject" />
              <Textarea name="body" required rows={3} placeholder="Message — sent as plain text and logged in the timeline" />
              <SubmitButton pendingLabel="Sending…">Send email</SubmitButton>
            </form>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold">Notes</h2>
            <form action={addNote} className="mt-3 flex gap-2">
              <input type="hidden" name="applicationId" value={a.id} />
              <Input name="body" placeholder="Add an internal note…" className="flex-1" />
              <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
            </form>
            <ul className="mt-3 space-y-2 text-sm">
              {notes.map((n, i) => (
                <li key={i} className="rounded-lg border border-border bg-card p-3">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{n.author} · {fmt(n.created_at)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

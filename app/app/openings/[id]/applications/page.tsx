import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import { fmtDate } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import SelectAll, { SelectedCount } from '@/components/SelectAll';
import BulkProgress from '@/components/BulkProgress';
import Flash from '@/components/Flash';
import DownloadLink from '@/components/DownloadLink';
import OpeningTabs from '@/components/OpeningTabs';
import { bulkPipeline } from '@/app/app/candidates/actions';
import { pipelineFlash } from '@/app/app/candidates/flash';
import BoardView from './BoardView';
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import {
  FEEDBACK_JOIN,
  PIPELINE_SORTS as SORTS,
  PIPELINE_WHERE,
  pipelineCtxParams,
  pipelineWhereParams,
} from '@/lib/pipeline';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import LiveSearch from '@/components/LiveSearch';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Field } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Pipeline` : 'Pipeline' };
}

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    stage?: string; status?: string; from?: string; to?: string; view?: string; sort?: string; q?: string;
    ok?: string; e?: string; imported?: string; skipped?: string;
  }>;
}) {
  const { id } = await params;
  const { stage, status = 'active', from = '', to = '', view, sort = 'score', q: term = '', ok, e, imported, skipped } =
    await searchParams;
  const board = view === 'board';
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string; status: string; slug: string; published: boolean }>(
    `select title, status, slug,
            exists (select 1 from public.forms f where f.opening_id = o.id and f.is_published) as published
     from public.openings o where id = $1`,
    [openingId]
  );
  if (!opening) notFound();
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();

  const { rows: stages } = await q<{ id: number; name: string; kind: string; count: number }>(
    `select s.id, s.name, s.kind,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as count
     from public.stages s where s.opening_id = $1 order by s.position`,
    [openingId]
  );

  // dead-end guard: interview stages someone could be moved into with no open slots
  const { rows: dryStages } = await q<{ name: string }>(
    `select s.name from public.stages s
     where s.opening_id = $1 and s.kind = 'interview'
       and not exists (
         select 1 from public.slots sl
         where sl.stage_id = s.id and sl.application_id is null and sl.starts_at > now()
       )`,
    [openingId]
  );

  const stageId = stage ? Number(stage) : null;
  const ctx = { stage, status, from, to, sort, q: term };
  const { rows: apps } = await q<{
    id: number;
    name: string;
    email: string;
    score: string | null;
    max_score: string | null;
    version: number;
    stage: string | null;
    stage_id: number | null;
    status: string;
    created_at: Date;
    fb_rating: number | null;
    fb_stage: string | null;
    fb_author: string | null;
    fb_comment: string | null;
  }>(
    `select a.id, a.name, a.email, a.score, a.max_score, f.version, s.name as stage,
            a.current_stage_id as stage_id, a.status, a.created_at,
            fb.rating as fb_rating, fb.stage as fb_stage, fb.author as fb_author, fb.comment as fb_comment
     from public.applications a
     join public.forms f on f.id = a.form_id
     left join public.stages s on s.id = a.current_stage_id
     ${FEEDBACK_JOIN}
     where ${PIPELINE_WHERE}
     order by ${SORTS[sort] ?? SORTS.score}`,
    pipelineWhereParams(openingId, ctx)
  );
  const ctxQs = pipelineCtxParams(openingId, ctx);
  const base = `/app/openings/${openingId}/applications`;
  // this page's own query string, for the view toggle and the post-action redirect
  const listQs = new URLSearchParams(
    Object.entries({ stage, status: status !== 'active' ? status : '', from, to, sort: sort !== 'score' ? sort : '', q: term })
      .filter(([, v]) => v) as [string, string][]
  );
  const withView = (v?: string) => {
    const p = new URLSearchParams(listQs);
    if (v) p.set('view', v);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const backHref = withView(board ? 'board' : undefined);
  const flash =
    pipelineFlash(ok, e) ??
    (imported != null
      ? {
          kind: 'success' as const,
          message: `Imported ${imported} candidate${imported === '1' ? '' : 's'}${
            Number(skipped) > 0 ? `; skipped ${skipped} (bad email or already in this pipeline)` : ''
          }`,
        }
      : null);

  const tab = (href: string, label: string, active: boolean, count?: number) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors',
        active ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      {count !== undefined && <span className="ml-1 opacity-70 tabular-nums">{count}</span>}
    </Link>
  );
  const segment = 'inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1';

  return (
    <div>
      <Flash kind={flash?.kind ?? 'success'} message={flash?.message} cleanParams={['ok', 'e', 'imported', 'skipped']} />
      <BackButton fallback={`/app/openings/${openingId}`} />
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">
          <Link href={`/app/openings/${openingId}`} className="text-muted-foreground hover:underline">
            {opening.title}
          </Link>{' '}
          · Pipeline
        </h1>
        <div className="mb-1 flex gap-2">
          <Link href={`${base}/new`} className={buttonVariants()}>
            <Plus data-icon="inline-start" />
            Add candidate
          </Link>
          <DownloadLink href={`${base}/export`} preparingLabel="Preparing CSV…">Download CSV</DownloadLink>
        </div>
      </div>
      <OpeningTabs openingId={openingId} current="pipeline" />

      {imported != null && (
        <Alert className="mt-4">
          <CheckCircle2 className="text-primary" />
          <AlertTitle>
            Imported {imported} candidate{imported === '1' ? '' : 's'}
            {Number(skipped) > 0 && ` · skipped ${skipped} row${skipped === '1' ? '' : 's'} with a missing name, bad email, or an email already in this pipeline`}
            .
          </AlertTitle>
        </Alert>
      )}

      {dryStages.length > 0 && (
        <Alert className="mt-4 border-amber/40 bg-amber/10 text-amber">
          <AlertTriangle />
          <AlertTitle>{dryStages.map((s) => s.name).join(', ')} has no open interview slots</AlertTitle>
          <AlertDescription className="text-amber/90">
            Candidates moved there will be invited to book but find nothing.{' '}
            <Link href={`/app/openings/${openingId}/slots`}>Create slots</Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className={segment}>
          {tab(withView(board ? undefined : 'board'), board ? 'List view' : 'Board view', false)}
        </div>
        <div className={cn(segment, 'max-w-full overflow-x-auto')}>
          {tab(base, 'All active', !board && !stageId && status === 'active')}
          {stages.map((s) =>
            tab(`${base}?stage=${s.id}`, s.name, stageId === s.id && status === 'active', s.count)
          )}
        </div>
        <div className={segment}>
          {tab(`${base}?status=rejected`, 'Rejected', status === 'rejected')}
          {tab(`${base}?status=hired`, 'Hired', status === 'hired')}
          {tab(`${base}?status=withdrawn`, 'Withdrawn', status === 'withdrawn')}
        </div>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-2 text-sm">
        {stage && <input type="hidden" name="stage" value={stage} />}
        {status !== 'active' && <input type="hidden" name="status" value={status} />}
        {board && <input type="hidden" name="view" value="board" />}
        <Field className="min-w-48 flex-1">
          <Label htmlFor="q">Name or email</Label>
          <LiveSearch id="q" name="q" defaultValue={term} placeholder="Search this pipeline…" />
        </Field>
        <Field className="w-40">
          <Label htmlFor="from">Applied from</Label>
          <Input id="from" type="date" name="from" defaultValue={from} />
        </Field>
        <Field className="w-40">
          <Label htmlFor="to">to</Label>
          <Input id="to" type="date" name="to" defaultValue={to} />
        </Field>
        <Field className="w-36">
          <Label htmlFor="sort">Sort by</Label>
          <NativeSelect id="sort" name="sort" defaultValue={sort}>
            <NativeSelectOption value="score">Form score</NativeSelectOption>
            <NativeSelectOption value="feedback">Latest feedback</NativeSelectOption>
            <NativeSelectOption value="newest">Newest</NativeSelectOption>
            <NativeSelectOption value="oldest">Oldest</NativeSelectOption>
            <NativeSelectOption value="name">Name</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Button type="submit" variant="outline">Apply</Button>
        {(from || to || term || sort !== 'score') && (
          <Link href={base} className="pb-2 text-muted-foreground underline">clear</Link>
        )}
      </form>

      {board ? (
        <BoardView
          openingId={openingId}
          ctxQs={ctxQs}
          stages={stages}
          dryStages={dryStages.map((s) => s.name)}
          cards={apps.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            score: a.score,
            max_score: a.max_score,
            stageId: a.stage_id,
            rating: a.fb_rating,
            ratingStage: a.fb_stage,
          }))}
        />
      ) : (
      <form action={bulkPipeline} className="mt-6">
        <input type="hidden" name="openingId" value={openingId} />
        <input type="hidden" name="back" value={backHref} />
        <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
              <TableHead className="w-10 px-4"><SelectAll name="appId" /></TableHead>
              <TableHead className="px-4">Candidate</TableHead>
              <TableHead className="px-4">Form score</TableHead>
              <TableHead className="px-4">Feedback</TableHead>
              <TableHead className="px-4">Stage</TableHead>
              <TableHead className="px-4">Applied</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="px-4 py-3">
                  <input type="checkbox" name="appId" value={a.id} />
                </TableCell>
                <TableCell className="p-0">
                  <Link
                    href={`/app/candidates/${a.id}?${ctxQs}`}
                    className="block px-4 py-3"
                    title="Open candidate profile"
                  >
                    <span className="font-medium text-primary hover:underline">{a.name} →</span>
                    <span className="block text-muted-foreground">{a.email}</span>
                  </Link>
                </TableCell>
                <TableCell className="px-4 py-3">
                  {a.score != null && Number(a.max_score) > 0
                    ? `${a.score} / ${a.max_score}`
                    : (a.score ?? '—')}
                  <span className="ml-1.5 text-xs text-muted-foreground">v{a.version}</span>
                </TableCell>
                <TableCell className="px-4 py-3">
                  {a.fb_rating != null ? (
                    <span title={`${a.fb_author}${a.fb_comment ? `: ${a.fb_comment}` : ''}`}>
                      <span className="text-amber">{'★'.repeat(a.fb_rating)}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{a.fb_stage ?? 'General'}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="px-4 py-3">{a.stage ?? '—'}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
              </TableRow>
            ))}
            {apps.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="whitespace-normal p-0">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {term || from || to || stageId || status !== 'active'
                          ? 'No candidates match these filters.'
                          : opening.status !== 'open'
                            ? 'No candidates yet.'
                            : 'No applications yet.'}
                      </EmptyTitle>
                      <EmptyDescription>
                        {term || from || to || stageId || status !== 'active' ? (
                          <Link href={base}>Show all active</Link>
                        ) : opening.status !== 'open' ? (
                          <>
                            This opening is <strong>{opening.status}</strong>, so nobody can apply.{' '}
                            {!opening.published && (
                              <>
                                <Link href={`/app/openings/${openingId}/form`}>Publish the form</Link>, then{' '}
                              </>
                            )}
                            <Link href={`/app/openings/${openingId}`}>set the status to open</Link>, or{' '}
                            <Link href={`${base}/new`}>add a candidate by hand</Link>.
                          </>
                        ) : (
                          <>
                            Share{' '}
                            <a href={`/careers/${opening.slug}`} target="_blank" rel="noopener">
                              /careers/{opening.slug}
                            </a>{' '}
                            or <Link href={`${base}/new`}>add a candidate by hand</Link>.
                          </>
                        )}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </Card>

        {apps.length > 0 && (
          <Card size="sm" className="sticky bottom-2 z-10 mt-4 shadow-md">
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <BulkProgress />
            <SelectedCount name="appId" />
            <span className="text-muted-foreground">·</span>
            <Label className="sr-only" htmlFor="bulkStage">Stage to move to</Label>
            <NativeSelect id="bulkStage" name="stageId" size="sm" className="w-44">
              {stages.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}{dryStages.some((d) => d.name === s.name) ? ' (no open slots!)' : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <SubmitButton
              name="intent"
              value="move"
              variant="outline"
              size="sm"
              pendingLabel="Moving…"
              confirmText="Move {n} candidate(s) to {stage}?"
              confirmMin={dryStages.length > 0 ? 1 : 2}
            >
              Move to stage
            </SubmitButton>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" name="notify" value="1" defaultChecked />
              Email the candidate about this move
            </label>
            <Separator orientation="vertical" className="mx-2 h-5!" />
            {status === 'active' ? (
              <>
                <SubmitButton name="intent" value="hire" variant="outline" size="sm" className="text-primary" pendingLabel="Hiring…" confirmText="Mark {n} candidate(s) as hired? They will each get the congratulations email.">Mark hired</SubmitButton>
                <SubmitButton name="intent" value="reject_send" variant="destructive" size="sm" pendingLabel="Rejecting…" confirmText="Reject {n} candidate(s) and email them now? This cannot be undone quietly — the email goes out immediately.">Reject + email now</SubmitButton>
                <SubmitButton name="intent" value="reject_draft" variant="destructive" size="sm" pendingLabel="Rejecting…" confirmText="Reject {n} candidate(s)? The rejection email is drafted in Emails for you to send later." title="Rejects and drafts the email — send it manually from the Emails tab">Reject + draft email</SubmitButton>
                <SubmitButton name="intent" value="withdraw" variant="outline" size="sm" pendingLabel="Updating…" confirmText="Mark {n} candidate(s) as withdrawn? No email is sent." title="For candidates who told you they are no longer interested">Mark withdrawn</SubmitButton>
              </>
            ) : (
              <SubmitButton name="intent" value="restore" variant="outline" size="sm" pendingLabel="Restoring…">Restore to active</SubmitButton>
            )}
            </CardContent>
          </Card>
        )}
        {apps.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            With the email box ticked, a move into a task or interview stage sends the candidate
            their instructions and portal link, and a move forward into any other stage sends a
            short progress update. Moves backwards or sideways never email. Untick the box to move
            silently. &quot;Reject + email now&quot; sends immediately; &quot;Reject + draft email&quot;
            parks the mail in <Link href="/app/emails" className="underline">Emails</Link> until you
            send it; &quot;Mark withdrawn&quot; never emails.
          </p>
        )}
      </form>
      )}
    </div>
  );
}

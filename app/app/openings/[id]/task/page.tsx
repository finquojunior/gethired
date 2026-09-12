import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtDay } from '@/lib/tz';
import { TASK_MAX_BYTES, TASK_TYPE_HELP } from '@/lib/uploads';
import { briefLinks, parseSubmissionFields } from '@/lib/brief';
import SubmissionFieldsEditor from '@/components/SubmissionFieldsEditor';
import { directUploads } from '@/lib/storage';
import SubmitButton from '@/components/SubmitButton';
import DirectUploadForm from '@/components/DirectUploadForm';
import OpeningTabs from '@/components/OpeningTabs';
import TaskSortSelect from '@/components/TaskSortSelect';
import { updateTaskMaterials } from '../../actions';
import { bulkPipeline } from '@/app/app/candidates/actions';
import { pipelineFlash } from '@/app/app/candidates/flash';
import SelectAll, { SelectedCount } from '@/components/SelectAll';
import BulkProgress from '@/components/BulkProgress';
import Flash from '@/components/Flash';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Task` : 'Task' };
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; e?: string; sort?: string }>;
}) {
  const { id } = await params;
  const { ok, e: errorCode, sort } = await searchParams;
  // fixed order-by fragments only — never user input. Default clusters deadlines
  // yet to come at the top (soonest first), then candidates with no deadline,
  // then overdue ones at the bottom (most recently overdue first).
  const TASK_SORTS: Record<string, string> = {
    deadline: `(case when deadline is null then 1 when deadline >= now() then 0 else 2 end),
               (case when deadline >= now() then deadline end) asc,
               (case when deadline < now() then deadline end) desc,
               lower(name)`,
    name: 'lower(name)',
    submitted: 'submitted_at desc nulls last, lower(name)',
    rating: 'latest_rating desc nulls last, lower(name)',
  };
  const sortKey = Object.hasOwn(TASK_SORTS, sort ?? '') ? sort! : 'deadline';
  const flash = pipelineFlash(ok, errorCode);
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();

  const { rows: tasks } = await q<{
    id: number;
    name: string;
    brief: string;
    brief_file_path: string;
    brief_links: string;
    submission_fields: unknown;
    task_days: number;
  }>(
    `select s.id, s.name, s.brief, s.brief_file_path, s.brief_links, s.submission_fields, s.task_days
     from public.stages s where s.opening_id = $1 and s.kind = 'task' order by s.position`,
    [openingId]
  );

  // everyone who ever reached a task stage (currently in it, or moved through
  // it per stage_history), with their latest submission for that stage
  const { rows: candidates } = await q<{
    stage_id: number;
    id: number;
    name: string;
    status: string;
    current_stage_id: number | null;
    current_stage: string | null;
    deadline: Date | null;
    submitted_at: Date | null;
    submission_count: number;
    response: string | null;
    latest_rating: number | null;
    rating_count: number;
  }>(
    `select * from (
       select s.id as stage_id, a.id, a.name, a.status, a.current_stage_id, cs.name as current_stage,
            case when s.task_days > 0 then
              coalesce((select max(h.created_at) from public.stage_history h
                         where h.application_id = a.id and h.to_stage_id = s.id), a.created_at)
              + make_interval(days => s.task_days)
            end as deadline,
            (select tr.response from public.task_responses tr
              where tr.application_id = a.id and tr.stage_id = s.id
              order by tr.id desc limit 1) as response,
            (select max(su.created_at) from public.submissions su
              where su.application_id = a.id and su.stage_id = s.id) as submitted_at,
            (select count(*)::int from public.submissions su
              where su.application_id = a.id and su.stage_id = s.id) as submission_count,
            (select f.rating from public.feedback f
              where f.application_id = a.id and f.stage_id = s.id and f.rating is not null
              order by f.updated_at desc limit 1) as latest_rating,
            (select count(*)::int from public.feedback f
              where f.application_id = a.id and f.stage_id = s.id and f.rating is not null) as rating_count
       from public.stages s
       join public.applications a on a.opening_id = s.opening_id and (
         a.current_stage_id = s.id or exists (
           select 1 from public.stage_history h
           where h.application_id = a.id and h.to_stage_id = s.id))
       left join public.stages cs on cs.id = a.current_stage_id
       where s.opening_id = $1 and s.kind = 'task'
     ) c
     order by ${TASK_SORTS[sortKey]}`,
    [openingId]
  );
  const today = fmtDate(new Date()); // org-local; overdue only once the deadline day has passed
  const candidatesByStage = new Map<number, typeof candidates>();
  for (const c of candidates) {
    if (!candidatesByStage.has(c.stage_id)) candidatesByStage.set(c.stage_id, []);
    candidatesByStage.get(c.stage_id)!.push(c);
  }
  // headline counts over candidates currently active in the stage
  const stats = (stageId: number) => {
    const now = (candidatesByStage.get(stageId) ?? []).filter((c) => c.status === 'active' && c.current_stage_id === stageId);
    const n = (f: (c: (typeof now)[number]) => boolean) => now.filter(f).length;
    return [
      ['In stage', now.length],
      ['Said yes', n((c) => c.response === 'yes')],
      ['Said no', n((c) => c.response === 'no')],
      ['No response', n((c) => !c.response)],
      ['Submitted', n((c) => !!c.submitted_at)],
      ['Yet to submit', n((c) => !c.submitted_at && c.response !== 'no')],
    ] as const;
  };

  const { rows: allStages } = await q<{ id: number; name: string }>(
    `select id, name from public.stages where opening_id = $1 order by position`,
    [openingId]
  );

  return (
    <div>
      <Flash kind={flash?.kind ?? 'success'} message={flash?.message} />
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-muted-foreground hover:underline">
          {opening.title}
        </Link>{' '}
        · Task
      </h1>
      <OpeningTabs openingId={openingId} current="task" />
      <p className="mt-4 text-sm text-muted-foreground">
        The brief, reference links, and document below are shown on the candidate&apos;s status page.
        Moving a candidate into the task stage emails them the brief and links; the document is
        downloadable from their portal.
      </p>

      {errorCode === 'file' && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle />
          <AlertTitle>Document upload failed. {TASK_TYPE_HELP}</AlertTitle>
        </Alert>
      )}

      {tasks.length === 0 && (
        <Empty className="mt-8 border bg-card">
          <EmptyHeader>
            <EmptyTitle>This opening has no task stage.</EmptyTitle>
            <EmptyDescription>
              <Link href={`/app/openings/${openingId}/stages`}>Add one on the Stages page</Link> (kind: task), then define the brief here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="mt-8 space-y-6">
        {tasks.map((t) => (
          <div key={t.id} className="space-y-4">
          <DirectUploadForm
            direct={directUploads}
            signUrl={`/app/openings/${openingId}/task/upload-url`}
            fileField="document"
            maxBytes={TASK_MAX_BYTES}
            action={updateTaskMaterials}
            className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <input type="hidden" name="openingId" value={openingId} />
            <input type="hidden" name="stageId" value={t.id} />
            <input type="hidden" name="documentPath" defaultValue="" />
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-lg font-semibold">{t.name}</h2>
              <Link
                href={`/app/openings/${openingId}/applications?stage=${t.id}`}
                className="text-sm text-primary underline"
              >
                open in pipeline
              </Link>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {stats(t.id).map(([label, n]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <dd className="font-display text-lg font-semibold tabular-nums">{n}</dd>
                  <dt className="text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>

            <div className="mt-4 space-y-4">
              <Field>
                <Label htmlFor={`brief-${t.id}`}>Brief</Label>
                <Textarea
                  id={`brief-${t.id}`}
                  name="brief"
                  rows={5}
                  defaultValue={t.brief}
                  placeholder="Task instructions sent to the candidate…" />
              </Field>

              <Field>
                <Label htmlFor={`days-${t.id}`}>Days to complete</Label>
                <FieldDescription>
                  Each candidate&apos;s deadline is counted from the day they were moved into this
                  stage. Leave 0 for no deadline.
                </FieldDescription>
                <Input
                  id={`days-${t.id}`}
                  type="number"
                  name="taskDays"
                  min={0}
                  max={365}
                  defaultValue={t.task_days}
                  className="w-32!"
                />
              </Field>

              <Field>
                <Label htmlFor={`links-${t.id}`}>Links (one per line, must start with http)</Label>
                <Textarea
                  id={`links-${t.id}`}
                  name="links"
                  rows={3}
                  defaultValue={t.brief_links}
                  placeholder={'https://github.com/…\nhttps://docs.google.com/…'} className="font-mono text-sm" />
              </Field>

              <Field>
                <Label htmlFor={`doc-${t.id}`}>Brief document (PDF, Word, or ZIP up to 16 MB)</Label>
                {t.brief_file_path && (
                  <p className="mb-2 flex items-center gap-3 text-sm">
                    <a
                      href={`/api/files/${t.brief_file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="text-primary underline"
                    >
                      View current document
                    </a>
                    <label className="flex items-center gap-1.5 text-muted-foreground">
                      <input type="checkbox" name="removeDocument" value="1" />
                      Remove on save
                    </label>
                  </p>
                )}
                <Input id={`doc-${t.id}`} type="file" name="document" />
              </Field>

              <Field>
                <Label>What candidates must submit</Label>
                <FieldDescription>
                  Each requirement appears as its own titled submission slot in the candidate
                  portal. Optional ones are marked as such; candidates can always add extra
                  free-form submissions too.
                </FieldDescription>
                <SubmissionFieldsEditor
                  name="submissionFields"
                  initial={parseSubmissionFields(t.submission_fields)}
                />
              </Field>

              <div className="flex items-center gap-3">
                <SubmitButton pendingLabel="Saving…" doneMessage="Task saved">Save task</SubmitButton>
                {!t.brief && !t.brief_file_path && briefLinks(t.brief_links).length === 0 && (
                  <span className="text-sm text-destructive">
                    Nothing set yet — candidates moved here would get &quot;Task details will follow.&quot;
                  </span>
                )}
              </div>
            </div>
          </DirectUploadForm>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="font-display text-lg font-semibold">Candidates in this task stage</CardTitle>
                  <CardDescription>Everyone who reached {t.name}, including candidates who have since moved on.</CardDescription>
                </div>
                {(candidatesByStage.get(t.id) ?? []).length > 1 && <TaskSortSelect value={sortKey} />}
              </div>
            </CardHeader>
            <CardContent>
              <form action={bulkPipeline}>
                <input type="hidden" name="openingId" value={openingId} />
                <input type="hidden" name="back" value={`/app/openings/${openingId}/task`} />
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                      <TableHead className="w-10 px-0"><SelectAll name="appId" /></TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Now at</TableHead>
                      <TableHead>Response</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(candidatesByStage.get(t.id) ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="px-0">
                          <input type="checkbox" name="appId" value={c.id} aria-label={`Select ${c.name}`} />
                        </TableCell>
                        <TableCell className="px-0">
                          <Link href={`/app/candidates/${c.id}?o=${openingId}&task=${t.id}`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.status === 'active' ? c.current_stage ?? '—' : c.status}
                        </TableCell>
                        <TableCell>
                          {c.response === 'yes' ? (
                            <Badge variant="secondary">Yes</Badge>
                          ) : c.response === 'no' ? (
                            <Badge variant="destructive">No</Badge>
                          ) : (
                            <Badge className="bg-amber/15 text-amber">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.deadline ? (
                            <span className={fmtDate(c.deadline) < today ? 'text-destructive' : 'text-primary'}>
                              {fmtDay(c.deadline)}
                              {fmtDate(c.deadline) < today && ' (overdue)'}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.submitted_at ? (
                            <span className="text-primary">
                              {c.submission_count > 1 ? `${c.submission_count} submissions` : 'Submitted'} ·
                              latest {fmtDateTime(c.submitted_at)}
                            </span>
                          ) : (
                            <Badge className="bg-amber/15 text-amber">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.latest_rating ? (
                            <>
                              <span className="text-amber">{'★'.repeat(c.latest_rating)}</span>
                              {c.rating_count > 1 && <span className="ml-1 text-xs text-muted-foreground">({c.rating_count})</span>}
                            </>
                          ) : (
                            <Link href={`/app/candidates/${c.id}#feedback`} className="text-xs text-primary underline">Score</Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(candidatesByStage.get(t.id) ?? []).length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">No candidates have reached this stage yet.</p>
                )}
                {(candidatesByStage.get(t.id) ?? []).length > 0 && (
                  <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-2 border-t border-border bg-card py-3 text-sm">
                    <BulkProgress />
                    <SelectedCount name="appId" />
                    <span className="text-muted-foreground">·</span>
                    <NativeSelect name="stageId" size="sm" className="w-44" aria-label="Stage to move to">
                      {allStages.map((s) => (
                        <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <SubmitButton name="intent" value="move" variant="outline" size="sm" pendingLabel="Moving…"
                      confirmText="Move {n} candidate(s) to {stage}?" confirmMin={2}>
                      Move to stage
                    </SubmitButton>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" name="notify" value="1" defaultChecked />
                      Email the candidate about this move
                    </label>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

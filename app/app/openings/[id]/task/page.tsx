import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/tz';
import { TASK_ACCEPT, TASK_MAX_BYTES } from '@/lib/uploads';
import { briefLinks, parseSubmissionFields } from '@/lib/brief';
import SubmissionFieldsEditor from '@/components/SubmissionFieldsEditor';
import { directUploads } from '@/lib/storage';
import SubmitButton from '@/components/SubmitButton';
import DirectUploadForm from '@/components/DirectUploadForm';
import { updateTaskMaterials } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { id } = await params;
  const { e: errorCode } = await searchParams;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();

  const { rows: tasks } = await q<{
    id: number;
    name: string;
    brief: string;
    brief_file_path: string;
    brief_links: string;
    submission_fields: unknown;
    active: number;
    submitted: number;
  }>(
    `select s.id, s.name, s.brief, s.brief_file_path, s.brief_links, s.submission_fields,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as active,
            (select count(distinct su.application_id)::int from public.submissions su
              where su.stage_id = s.id) as submitted
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
    current_stage: string | null;
    submitted_at: Date | null;
    submission_count: number;
    response: string | null;
  }>(
    `select s.id as stage_id, a.id, a.name, a.status, cs.name as current_stage,
            (select tr.response from public.task_responses tr
              where tr.application_id = a.id and tr.stage_id = s.id
              order by tr.id desc limit 1) as response,
            (select max(su.created_at) from public.submissions su
              where su.application_id = a.id and su.stage_id = s.id) as submitted_at,
            (select count(*)::int from public.submissions su
              where su.application_id = a.id and su.stage_id = s.id) as submission_count
     from public.stages s
     join public.applications a on a.opening_id = s.opening_id and (
       a.current_stage_id = s.id or exists (
         select 1 from public.stage_history h
         where h.application_id = a.id and h.to_stage_id = s.id))
     left join public.stages cs on cs.id = a.current_stage_id
     where s.opening_id = $1 and s.kind = 'task'
     order by submitted_at desc nulls last, a.name`,
    [openingId]
  );
  const candidatesByStage = new Map<number, typeof candidates>();
  for (const c of candidates) {
    if (!candidatesByStage.has(c.stage_id)) candidatesByStage.set(c.stage_id, []);
    candidatesByStage.get(c.stage_id)!.push(c);
  }

  return (
    <div>
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Task
      </h1>
      <p className="mt-4 text-sm text-ink-soft">
        The brief, reference links, and document below are shown on the candidate&apos;s status page.
        Moving a candidate into the task stage emails them the brief and links; the document is
        downloadable from their portal.
      </p>

      {errorCode === 'file' && (
        <p className="mt-4 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">
          Document upload failed. Use PDF, Word, or ZIP up to 16 MB.
        </p>
      )}

      {tasks.length === 0 && (
        <p className="mt-8 rounded-lg border border-line bg-card p-5 text-sm text-ink-soft">
          This opening has no task stage.{' '}
          <Link href={`/app/openings/${openingId}/stages`} className="text-pine underline">
            Add one on the Stages page
          </Link>{' '}
          (kind: task), then define the brief here.
        </p>
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
            encType="multipart/form-data"
            className="rounded-lg border border-line bg-card p-5"
          >
            <input type="hidden" name="openingId" value={openingId} />
            <input type="hidden" name="stageId" value={t.id} />
            <input type="hidden" name="documentPath" defaultValue="" />
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-lg font-semibold">{t.name}</h2>
              <span className="text-sm text-ink-soft">{t.active} active in this stage</span>
              <Link
                href={`/app/openings/${openingId}/applications?stage=${t.id}`}
                className="text-sm text-pine underline"
              >
                {t.submitted} submitted
              </Link>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="field-label">Brief</label>
                <textarea
                  name="brief"
                  rows={5}
                  defaultValue={t.brief}
                  placeholder="Task instructions sent to the candidate…"
                  className="input"
                />
              </div>

              <div>
                <label className="field-label">Links (one per line, must start with http)</label>
                <textarea
                  name="links"
                  rows={3}
                  defaultValue={t.brief_links}
                  placeholder={'https://github.com/…\nhttps://docs.google.com/…'}
                  className="input font-mono text-sm"
                />
              </div>

              <div>
                <label className="field-label">Brief document (PDF, Word, or ZIP up to 16 MB)</label>
                {t.brief_file_path && (
                  <p className="mb-2 flex items-center gap-3 text-sm">
                    <a
                      href={`/api/files/${t.brief_file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="text-pine underline"
                    >
                      View current document
                    </a>
                    <label className="flex items-center gap-1.5 text-ink-soft">
                      <input type="checkbox" name="removeDocument" value="1" />
                      Remove on save
                    </label>
                  </p>
                )}
                <input type="file" name="document" accept={TASK_ACCEPT} className="input" />
              </div>

              <div>
                <label className="field-label">What candidates must submit</label>
                <p className="mb-2 text-xs text-ink-soft">
                  Each requirement appears as its own titled submission slot in the candidate
                  portal. Optional ones are marked as such; candidates can always add extra
                  free-form submissions too.
                </p>
                <SubmissionFieldsEditor
                  name="submissionFields"
                  initial={parseSubmissionFields(t.submission_fields)}
                />
              </div>

              <div className="flex items-center gap-3">
                <SubmitButton className="btn-primary" pendingLabel="Saving…" doneMessage="Task saved">Save task</SubmitButton>
                {!t.brief && !t.brief_file_path && briefLinks(t.brief_links).length === 0 && (
                  <span className="text-sm text-rust">
                    Nothing set yet — candidates moved here would get &quot;Task details will follow.&quot;
                  </span>
                )}
              </div>
            </div>
          </DirectUploadForm>

          <section className="rounded-lg border border-line bg-card p-5">
            <h3 className="font-display text-lg font-semibold">Candidates in this task round</h3>
            <p className="mt-1 text-xs text-ink-soft">
              Everyone who reached {t.name}, including candidates who have since moved on.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                    <th className="py-1 pr-4">Candidate</th>
                    <th className="py-1 pr-4">Now at</th>
                    <th className="py-1 pr-4">Response</th>
                    <th className="py-1">Task</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(candidatesByStage.get(t.id) ?? []).map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 pr-4">
                        <Link href={`/app/candidates/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-ink-soft">
                        {c.status === 'active' ? c.current_stage ?? '—' : c.status}
                      </td>
                      <td className="py-2 pr-4">
                        {c.response === 'yes' ? (
                          <span className="font-medium text-pine-deep">Yes</span>
                        ) : c.response === 'no' ? (
                          <span className="font-medium text-rust">No</span>
                        ) : (
                          <span className="text-amber">Pending</span>
                        )}
                      </td>
                      <td className="py-2">
                        {c.submitted_at ? (
                          <span className="text-pine-deep">
                            {c.submission_count > 1 ? `${c.submission_count} submissions` : 'Submitted'} ·
                            latest {fmtDateTime(c.submitted_at)}
                          </span>
                        ) : (
                          <span className="text-amber">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(candidatesByStage.get(t.id) ?? []).length === 0 && (
                <p className="mt-2 text-sm text-ink-soft">No candidates have reached this stage yet.</p>
              )}
            </div>
          </section>
          </div>
        ))}
      </div>
    </div>
  );
}

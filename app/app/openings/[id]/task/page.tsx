import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { TASK_ACCEPT } from '@/lib/uploads';
import { briefLinks } from '@/lib/brief';
import SubmitButton from '@/components/SubmitButton';
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
    active: number;
    submitted: number;
  }>(
    `select s.id, s.name, s.brief, s.brief_file_path, s.brief_links,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as active,
            (select count(distinct su.application_id)::int from public.submissions su
              where su.stage_id = s.id) as submitted
     from public.stages s where s.opening_id = $1 and s.kind = 'task' order by s.position`,
    [openingId]
  );

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
          Document upload failed. Use PDF, Word, or ZIP up to 10 MB.
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
          <form
            key={t.id}
            action={updateTaskMaterials}
            encType="multipart/form-data"
            className="rounded-lg border border-line bg-card p-5"
          >
            <input type="hidden" name="openingId" value={openingId} />
            <input type="hidden" name="stageId" value={t.id} />
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
                <label className="field-label">Brief document (PDF, Word, or ZIP up to 10 MB)</label>
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

              <div className="flex items-center gap-3">
                <SubmitButton className="btn-primary" pendingLabel="Saving…">Save task</SubmitButton>
                {!t.brief && !t.brief_file_path && briefLinks(t.brief_links).length === 0 && (
                  <span className="text-sm text-rust">
                    Nothing set yet — candidates moved here would get &quot;Task details will follow.&quot;
                  </span>
                )}
              </div>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}

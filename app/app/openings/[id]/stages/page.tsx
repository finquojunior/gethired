import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import SubmitButton from '@/components/SubmitButton';
import { addStage, deleteStage, shiftStage, updateStage } from '../../actions';

export const dynamic = 'force-dynamic';

const KINDS = ['screen', 'task', 'interview', 'offer'];

export default async function StagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();

  const { rows: stages } = await q<{
    id: number;
    name: string;
    kind: string;
    brief: string;
    candidates: number;
  }>(
    `select s.id, s.name, s.kind, s.brief,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as candidates
     from public.stages s where s.opening_id = $1 order by s.position`,
    [openingId]
  );

  return (
    <div>
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Stages
      </h1>
      <p className="mt-4 text-sm text-ink-soft">
        Candidates move through these in order. The brief on task and interview stages is emailed
        to candidates and shown on their status page.
      </p>

      <div className="mt-8 space-y-3">
        {stages.map((s, i) => (
          <form
            key={s.id}
            action={updateStage}
            className="flex items-start gap-2 rounded-lg border border-line bg-card p-4"
          >
            <input type="hidden" name="openingId" value={openingId} />
            <input type="hidden" name="stageId" value={s.id} />
            <div className="flex flex-col gap-1 pt-1">
              <button formAction={shiftStage.bind(null, openingId, s.id, -1)} disabled={i === 0}
                className="text-ink-soft hover:text-ink disabled:opacity-30">↑</button>
              <button formAction={shiftStage.bind(null, openingId, s.id, 1)} disabled={i === stages.length - 1}
                className="text-ink-soft hover:text-ink disabled:opacity-30">↓</button>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input name="name" defaultValue={s.name} className="input w-56" />
                <select name="kind" defaultValue={s.kind} className="input w-36">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                <span className="text-sm text-ink-soft">{s.candidates} active</span>
                <div className="flex-1" />
                <SubmitButton className="btn-quiet" pendingLabel="Saving…">Save</SubmitButton>
                <SubmitButton
                  formAction={deleteStage}
                  disabled={s.candidates > 0}
                  title={s.candidates > 0 ? 'Move candidates out first' : 'Delete stage'}
                  className="btn-quiet text-rust disabled:opacity-40"
                  pendingLabel="…"
                >
                  Delete
                </SubmitButton>
              </div>
              {(s.kind === 'task' || s.kind === 'interview') && (
                <textarea
                  name="brief"
                  rows={2}
                  defaultValue={s.brief}
                  placeholder={
                    s.kind === 'task'
                      ? 'Task instructions sent to the candidate…'
                      : 'Interview details (location / meet link)…'
                  }
                  className="input"
                />
              )}
            </div>
          </form>
        ))}
      </div>

      <form action={addStage} className="mt-6 flex items-end gap-2">
        <input type="hidden" name="openingId" value={openingId} />
        <div>
          <label className="field-label">New stage</label>
          <input name="name" placeholder="e.g. Second interview" className="input w-56" />
        </div>
        <select name="kind" className="input w-36">
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <SubmitButton className="btn-primary" pendingLabel="Adding…">Add stage</SubmitButton>
      </form>
    </div>
  );
}

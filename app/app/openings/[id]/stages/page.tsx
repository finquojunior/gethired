import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import SubmitButton from '@/components/SubmitButton';
import Flash from '@/components/Flash';
import OpeningTabs from '@/components/OpeningTabs';
import { addStage, deleteStage, shiftStage, updateStage } from '../../actions';

export const dynamic = 'force-dynamic';

const KINDS = ['screen', 'task', 'interview', 'offer'];
const KIND_HELP: Record<string, string> = {
  screen: 'plain review step — moving a candidate here forward sends a short progress email',
  task: 'unlocks the Task tab; moving a candidate here emails the brief and opens submissions in their portal',
  interview: 'enables Interview slots; moving a candidate here emails an invite to pick a slot',
  offer: 'feeds the "At offer stage" dashboard count',
};
const ERRORS: Record<string, string> = {
  hasCandidates: 'That stage still has active candidates — move them out first.',
  hasBookings: 'That stage has booked future interviews — cancel them from the candidate pages first.',
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Stages` : 'Stages' };
}

export default async function StagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { id } = await params;
  const { e } = await searchParams;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();

  const { rows: stages } = await q<{
    id: number;
    name: string;
    kind: string;
    brief: string;
    candidates: number;
    booked: number;
  }>(
    `select s.id, s.name, s.kind, s.brief,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as candidates,
            (select count(*)::int from public.slots sl
              where sl.stage_id = s.id and sl.application_id is not null and sl.starts_at > now()) as booked
     from public.stages s where s.opening_id = $1 order by s.position`,
    [openingId]
  );

  return (
    <div>
      <Flash kind="error" message={e ? ERRORS[e] : null} />
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Stages
      </h1>
      <OpeningTabs openingId={openingId} current="stages" />
      <p className="mt-4 text-sm text-ink-soft">
        Candidates move through these in order. Interview details typed here are emailed with the
        invite and shown on the candidate&apos;s status page. Task briefs, documents, and links are
        managed on the{' '}
        <Link href={`/app/openings/${openingId}/task`} className="text-pine underline">
          Task tab
        </Link>
        .
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
                aria-label={`Move ${s.name} up`} title="Move up"
                className="text-ink-soft hover:text-ink disabled:opacity-30">↑</button>
              <button formAction={shiftStage.bind(null, openingId, s.id, 1)} disabled={i === stages.length - 1}
                aria-label={`Move ${s.name} down`} title="Move down"
                className="text-ink-soft hover:text-ink disabled:opacity-30">↓</button>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input name="name" aria-label="Stage name" defaultValue={s.name} required className="input w-56" />
                <select name="kind" aria-label="Stage kind" defaultValue={s.kind} className="input w-36">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                <span className="text-sm text-ink-soft">
                  {s.candidates} active{s.booked > 0 && ` · ${s.booked} interview${s.booked === 1 ? '' : 's'} booked`}
                </span>
                <div className="flex-1" />
                <SubmitButton name="intent" value="save" className="btn-quiet" pendingLabel="Saving…" doneMessage="Stage saved">Save</SubmitButton>
                <SubmitButton
                  name="intent"
                  value="delete"
                  formAction={deleteStage}
                  disabled={s.candidates > 0 || s.booked > 0}
                  title={
                    s.candidates > 0
                      ? 'Move candidates out first'
                      : s.booked > 0
                        ? 'Cancel the booked interviews first'
                        : 'Delete stage'
                  }
                  confirmText={`Delete the "${s.name}" stage? Candidates who passed through it stay in their history.`}
                  className="btn-danger"
                  pendingLabel="Deleting…"
                >
                  Delete
                </SubmitButton>
              </div>
              {s.kind === 'task' && (
                <p className="text-sm text-ink-soft">
                  {s.brief ? 'Brief set' : 'No brief yet'} —{' '}
                  <Link href={`/app/openings/${openingId}/task`} className="text-pine underline">
                    edit the brief, links, and document on the Task tab
                  </Link>
                </p>
              )}
              {s.kind === 'interview' && (
                <textarea
                  name="brief"
                  aria-label="Interview details"
                  rows={2}
                  defaultValue={s.brief}
                  placeholder="Interview details (location / meet link)…"
                  className="input"
                />
              )}
            </div>
          </form>
        ))}
      </div>

      <ul className="mt-4 space-y-0.5 text-xs text-ink-soft">
        {KINDS.map((k) => (
          <li key={k}>
            <strong className="text-ink">{k}</strong> — {KIND_HELP[k]}
          </li>
        ))}
      </ul>

      <form action={addStage} className="mt-6 flex flex-wrap items-end gap-2">
        <input type="hidden" name="openingId" value={openingId} />
        <div>
          <label className="field-label" htmlFor="new-stage-name">New stage *</label>
          <input id="new-stage-name" name="name" required placeholder="e.g. Second interview" className="input w-56" />
        </div>
        <div>
          <label className="field-label" htmlFor="new-stage-kind">Kind</label>
          <select id="new-stage-kind" name="kind" className="input w-36">
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Adding…" doneMessage="Stage added">Add stage</SubmitButton>
      </form>
    </div>
  );
}

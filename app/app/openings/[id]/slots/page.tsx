import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import { createSlots, deleteSlot } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function SlotsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();

  const { rows: interviewStages } = await q<{ id: number; name: string }>(
    `select id, name from public.stages where opening_id = $1 and kind = 'interview' order by position`,
    [openingId]
  );
  const { rows: people } = await q<{ id: string; full_name: string }>(
    `select id, full_name from public.profiles order by full_name`
  );
  const { rows: slots } = await q<{
    id: number;
    starts_at: Date;
    duration_mins: number;
    stage: string;
    interviewer: string;
    panel_names: string | null;
    candidate_id: number | null;
    candidate: string | null;
  }>(
    `select sl.id, sl.starts_at, sl.duration_mins, st.name as stage,
            p.full_name as interviewer, a.id as candidate_id, a.name as candidate,
            (select string_agg(pp.full_name, ', ') from public.profiles pp where pp.id = any(sl.panel)) as panel_names
     from public.slots sl
     join public.stages st on st.id = sl.stage_id
     join public.profiles p on p.id = sl.interviewer_id
     left join public.applications a on a.id = sl.application_id
     where sl.opening_id = $1
     order by sl.starts_at`,
    [openingId]
  );

  return (
    <div>
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Interview slots
      </h1>

      {interviewStages.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          This opening has no interview stage.{' '}
          <Link href={`/app/openings/${openingId}/stages`} className="text-pine underline">
            Add one in Stages
          </Link>{' '}
          first.
        </p>
      ) : (
        <form action={createSlots} className="mt-8 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card p-4">
          <input type="hidden" name="openingId" value={openingId} />
          <div>
            <label className="field-label">Stage</label>
            <select name="stageId" className="input w-40">
              {interviewStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Interview panel (⌘/Ctrl-click for multiple; first = primary)</label>
            <select name="interviewerIds" multiple size={Math.min(4, people.length)} className="input w-52">
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Date</label>
            <input type="date" name="date" required className="input w-40" />
          </div>
          <div>
            <label className="field-label">From</label>
            <input type="time" name="from" required defaultValue="10:00" className="input w-28" />
          </div>
          <div>
            <label className="field-label">To</label>
            <input type="time" name="to" required defaultValue="16:00" className="input w-28" />
          </div>
          <div>
            <label className="field-label">Minutes each</label>
            <input type="number" name="duration" defaultValue={30} min={5} className="input w-24" />
          </div>
          <div className="min-w-64 flex-1">
            <label className="field-label">Meeting link / location (sent to the candidate)</label>
            <input name="meetingLink" placeholder="https://meet.google.com/… or office address" className="input" />
          </div>
          <SubmitButton className="btn-primary" pendingLabel="Creating…">Create slots</SubmitButton>
        </form>
      )}

      <div className="mt-8 overflow-x-auto rounded-lg border border-line bg-card"><table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
            <th className="px-4 py-3">When</th>
            <th className="px-4 py-3">Stage</th>
            <th className="px-4 py-3">Interviewer</th>
            <th className="px-4 py-3">Booked by</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {slots.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-2.5">
                {fmtDateTime(s.starts_at)}
                <span className="text-ink-soft"> · {s.duration_mins}m</span>
              </td>
              <td className="px-4 py-2.5">{s.stage}</td>
              <td className="px-4 py-2.5">
                {s.interviewer}
                {s.panel_names && <span className="text-ink-soft"> + {s.panel_names}</span>}
              </td>
              <td className="px-4 py-2.5">
                {s.candidate_id ? (
                  <Link href={`/app/candidates/${s.candidate_id}`} className="text-pine underline">
                    {s.candidate}
                  </Link>
                ) : (
                  <span className="text-ink-soft">open</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                {!s.candidate_id && (
                  <form action={deleteSlot}>
                    <input type="hidden" name="openingId" value={openingId} />
                    <input type="hidden" name="slotId" value={s.id} />
                    <SubmitButton className="text-rust hover:underline" pendingLabel="…">Delete</SubmitButton>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {slots.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                No slots yet. Create a batch above — candidates pick from open slots.
              </td>
            </tr>
          )}
        </tbody>
      </table></div>
    </div>
  );
}

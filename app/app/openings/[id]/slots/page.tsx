import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import { ORG_TZ, fmtDate, fmtDateTime, fmtDay } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import Flash from '@/components/Flash';
import OpeningTabs from '@/components/OpeningTabs';
import { createSlots, deleteSlot } from '../../actions';

export const dynamic = 'force-dynamic';

const TZ_LABEL = ORG_TZ === 'Asia/Kolkata' ? 'IST' : `org local time, ${ORG_TZ}`;
const ERRORS: Record<string, string> = {
  window: 'No slots created — "To" must be after "From" by at least one slot length.',
  stage: 'No slots created — pick an interview stage.',
  interviewer: 'No slots created — pick a primary interviewer.',
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Interview slots` : 'Interview slots' };
}

export default async function SlotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string; ok?: string; past?: string }>;
}) {
  const { id } = await params;
  const { e, ok, past } = await searchParams;
  const showPast = past === '1';
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();

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
     where sl.opening_id = $1 and ($2::boolean or sl.starts_at + make_interval(mins => sl.duration_mins) > now())
     order by sl.starts_at`,
    [openingId, showPast]
  );
  const {
    rows: [{ n: pastCount }],
  } = await q<{ n: number }>(
    `select count(*)::int as n from public.slots sl
     where sl.opening_id = $1 and sl.starts_at + make_interval(mins => sl.duration_mins) <= now()`,
    [openingId]
  );
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) {
    const day = fmtDay(s.starts_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(s);
  }
  const today = fmtDate(new Date());
  const okN = ok?.startsWith('slots:') ? Number(ok.slice(6)) : 0;

  return (
    <div>
      <Flash
        kind={okN ? 'success' : 'error'}
        message={okN ? `Created ${okN} slot${okN === 1 ? '' : 's'}` : e ? ERRORS[e] ?? null : null}
      />
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Interview slots
      </h1>
      <OpeningTabs openingId={openingId} current="slots" />

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
            <label className="field-label" htmlFor="slot-stage">Stage</label>
            <select id="slot-stage" name="stageId" className="input w-40">
              {interviewStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="slot-interviewer">Primary interviewer</label>
            <select id="slot-interviewer" name="interviewerId" required className="input w-52">
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
          <fieldset className="min-w-48">
            <legend className="field-label">Panel (optional)</legend>
            <div className="flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-sm">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input type="checkbox" name="panelIds" value={p.id} className="accent-pine" />
                  {p.full_name}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="field-label" htmlFor="slot-date">Date</label>
            <input id="slot-date" type="date" name="date" required min={today} className="input w-40" />
          </div>
          <div>
            <label className="field-label" htmlFor="slot-from">From ({TZ_LABEL})</label>
            <input id="slot-from" type="time" name="from" required defaultValue="10:00" className="input w-28" />
          </div>
          <div>
            <label className="field-label" htmlFor="slot-to">To ({TZ_LABEL})</label>
            <input id="slot-to" type="time" name="to" required defaultValue="16:00" className="input w-28" />
          </div>
          <div>
            <label className="field-label" htmlFor="slot-duration">Minutes each</label>
            <input id="slot-duration" type="number" name="duration" defaultValue={30} min={5} className="input w-24" />
          </div>
          <div className="min-w-64 flex-1">
            <label className="field-label" htmlFor="slot-link">Meeting link / location (sent to the candidate)</label>
            <input id="slot-link" name="meetingLink" placeholder="https://meet.google.com/… or office address" className="input" />
          </div>
          <SubmitButton className="btn-primary" pendingLabel="Creating…">Create slots</SubmitButton>
          <p className="basis-full text-xs text-ink-soft">
            One slot every &quot;minutes each&quot; between From and To. The primary interviewer and panel are
            emailed when a candidate books.
          </p>
        </form>
      )}

      <div className="mt-8 flex items-center justify-between text-sm">
        <span className="text-ink-soft">{showPast ? 'All slots' : 'Upcoming slots'}</span>
        {showPast ? (
          <Link href={`/app/openings/${openingId}/slots`} className="text-pine underline">Hide past</Link>
        ) : pastCount > 0 ? (
          <Link href={`/app/openings/${openingId}/slots?past=1`} className="text-pine underline">
            Show past ({pastCount})
          </Link>
        ) : null}
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-card"><table className="w-full text-sm">
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
          {[...byDay.entries()].flatMap(([day, rows]) => [
            <tr key={`day-${day}`} className="bg-paper">
              <th colSpan={5} scope="rowgroup" className="px-4 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                {day} · {rows.length} slot{rows.length === 1 ? '' : 's'} · {rows.filter((r) => !r.candidate_id).length} open
              </th>
            </tr>,
            ...rows.map((s) => (
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
                    <SubmitButton
                      className="btn-danger !py-1"
                      pendingLabel="Deleting…"
                      confirmText={`Delete the ${fmtDateTime(s.starts_at)} slot?`}
                    >
                      Delete
                    </SubmitButton>
                  </form>
                )}
              </td>
            </tr>
            )),
          ])}
          {slots.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                {showPast || pastCount === 0
                  ? 'No slots yet. Create a batch above — candidates pick from open slots.'
                  : 'No upcoming slots. Create a batch above — candidates pick from open slots.'}
              </td>
            </tr>
          )}
        </tbody>
      </table></div>
    </div>
  );
}

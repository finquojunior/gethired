import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export default async function InterviewsPage() {
  const [{ rows: upcoming }, { rows: openings }] = await Promise.all([
    q<{
      id: number;
      candidate: string;
      title: string;
      stage: string;
      starts_at: Date;
      duration_mins: number;
      interviewer: string;
      panel_names: string | null;
      meeting_link: string;
    }>(
      `select a.id, a.name as candidate, o.title, st.name as stage, sl.starts_at,
              sl.duration_mins, p.full_name as interviewer, sl.meeting_link,
              (select string_agg(pp.full_name, ', ') from public.profiles pp where pp.id = any(sl.panel)) as panel_names
       from public.slots sl
       join public.applications a on a.id = sl.application_id
       join public.openings o on o.id = a.opening_id
       join public.stages st on st.id = sl.stage_id
       join public.profiles p on p.id = sl.interviewer_id
       where sl.starts_at > now() and a.status = 'active'
       order by sl.starts_at limit 50`
    ),
    q<{ id: number; title: string; status: string; open_slots: number; booked: number }>(
      `select o.id, o.title, o.status,
              count(sl.id) filter (where sl.application_id is null and sl.starts_at > now())::int as open_slots,
              count(sl.id) filter (where sl.application_id is not null and sl.starts_at > now())::int as booked
       from public.openings o
       join public.stages s on s.opening_id = o.id and s.kind = 'interview'
       left join public.slots sl on sl.opening_id = o.id
       where o.status <> 'closed'
       group by o.id
       order by o.created_at desc`
    ),
  ]);

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Interviews</h1>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Upcoming</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {upcoming.map((u, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-4 py-3">
              <span>
                <Link href={`/app/candidates/${u.id}`} className="font-medium text-pine hover:underline">
                  {u.candidate}
                </Link>
                <span className="text-ink-soft"> · {u.title} · {u.stage}</span>
              </span>
              <span className="text-ink-soft">
                {fmtDateTime(u.starts_at)} · {u.duration_mins}m · {u.interviewer}
                {u.panel_names && ` + ${u.panel_names}`}
                {u.meeting_link && /^https?:\/\//.test(u.meeting_link) && (
                  <>
                    {' · '}
                    <a href={u.meeting_link} target="_blank" rel="noopener" className="text-pine underline">
                      join
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
          {upcoming.length === 0 && (
            <li className="rounded-lg border border-line bg-card px-4 py-6 text-center text-ink-soft">
              No upcoming interviews booked.
            </li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Slots by opening</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Create and manage interview slots per opening — candidates in an interview stage pick
          from the open ones.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {openings.map((o) => (
            <Link
              key={o.id}
              href={`/app/openings/${o.id}/slots`}
              className="rounded-lg border border-line bg-card p-4 hover:border-pine"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{o.title}</span>
                {o.open_slots === 0 && o.booked === 0 ? (
                  <span className="shrink-0 rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-medium text-amber">
                    no slots
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-pine-wash px-2.5 py-0.5 text-xs font-medium text-pine-deep">
                    {o.open_slots} open
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm text-ink-soft">
                {o.booked} booked · {o.status}
              </div>
            </Link>
          ))}
          {openings.length === 0 && (
            <p className="text-sm text-ink-soft">
              No openings with an interview stage yet — add one in an opening&apos;s Stages tab.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const [
    { rows: funnel },
    { rows: sources },
    { rows: tth },
    { rows: weekly },
    { rows: reach },
    { rows: ratings },
    { rows: moves },
    { rows: outcomes },
    { rows: openings },
  ] = await Promise.all([
    q<{
      opening_id: number;
      title: string;
      total: number;
      active: number;
      hired: number;
      rejected: number;
      withdrawn: number;
    }>(
      `select o.id as opening_id, o.title,
              count(a.id)::int as total,
              count(a.id) filter (where a.status = 'active')::int as active,
              count(a.id) filter (where a.status = 'hired')::int as hired,
              count(a.id) filter (where a.status = 'rejected')::int as rejected,
              count(a.id) filter (where a.status = 'withdrawn')::int as withdrawn
       from public.openings o
       left join public.applications a on a.opening_id = o.id
       group by o.id having count(a.id) > 0
       order by total desc`
    ),
    q<{ source: string; total: number; hired: number; interviews: number }>(
      `select coalesce(nullif(a.utm->>'utm_source', ''), 'direct') as source,
              count(*)::int as total,
              count(*) filter (where a.status = 'hired')::int as hired,
              count(distinct sl.application_id)::int as interviews
       from public.applications a
       left join public.slots sl on sl.application_id = a.id
       group by 1 order by total desc`
    ),
    q<{ title: string; avg_days: string }>(
      `select o.title, round(avg(extract(epoch from (a.updated_at - a.created_at)) / 86400), 1)::text as avg_days
       from public.applications a join public.openings o on o.id = a.opening_id
       where a.status = 'hired'
       group by o.id`
    ),
    q<{ week: Date; count: number }>(
      `select date_trunc('week', created_at) as week, count(*)::int as count
       from public.applications
       where created_at > now() - interval '8 weeks'
       group by 1 order by 1`
    ),
    // how far candidates get: ever entered a stage of each kind (history or current)
    q<{ opening_id: number; title: string; applied: number; task: number; interview: number; offer: number; hired: number }>(
      `select o.id as opening_id, o.title,
              count(a.id)::int as applied,
              count(a.id) filter (where exists (
                select 1 from public.stages s
                where s.kind = 'task' and (s.id = a.current_stage_id or exists (
                  select 1 from public.stage_history h
                  where h.application_id = a.id and h.to_stage_id = s.id))))::int as task,
              count(a.id) filter (where exists (
                select 1 from public.stages s
                where s.kind = 'interview' and (s.id = a.current_stage_id or exists (
                  select 1 from public.stage_history h
                  where h.application_id = a.id and h.to_stage_id = s.id))))::int as interview,
              count(a.id) filter (where exists (
                select 1 from public.stages s
                where s.kind = 'offer' and (s.id = a.current_stage_id or exists (
                  select 1 from public.stage_history h
                  where h.application_id = a.id and h.to_stage_id = s.id))))::int as offer,
              count(a.id) filter (where a.status = 'hired')::int as hired
       from public.openings o
       join public.applications a on a.opening_id = o.id
       group by o.id order by applied desc`
    ),
    q<{ title: string; avg_rating: string; n: number }>(
      `select o.title, round(avg(f.rating), 1)::text as avg_rating, count(f.id)::int as n
       from public.feedback f
       join public.applications a on a.id = f.application_id
       join public.openings o on o.id = a.opening_id
       where f.rating is not null
       group by o.id order by avg(f.rating) desc`
    ),
    q<{ when: Date; name: string; app_id: number; stage: string; title: string }>(
      `select h.created_at as when, a.name, a.id as app_id, s.name as stage, o.title
       from public.stage_history h
       join public.applications a on a.id = h.application_id
       join public.openings o on o.id = a.opening_id
       left join public.stages s on s.id = h.to_stage_id
       order by h.created_at desc limit 12`
    ),
    q<{ when: Date; name: string; app_id: number; status: string; title: string }>(
      `select a.updated_at as when, a.name, a.id as app_id, a.status, o.title
       from public.applications a
       join public.openings o on o.id = a.opening_id
       where a.status in ('hired', 'rejected')
       order by a.updated_at desc limit 8`
    ),
    q<{ id: number; title: string }>(
      `select id, title from public.openings order by created_at desc`
    ),
  ]);

  // one merged, newest-first activity feed from stage moves + final outcomes
  const activity = [
    ...moves.map((m) => ({
      when: m.when,
      app_id: m.app_id,
      name: m.name,
      text: `moved to ${m.stage ?? 'a removed stage'} · ${m.title}`,
    })),
    ...outcomes.map((o) => ({
      when: o.when,
      app_id: o.app_id,
      name: o.name,
      text: `${o.status} · ${o.title}`,
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, 15);

  const maxWeekly = Math.max(1, ...weekly.map((w) => w.count));
  const card = 'rounded-lg border border-line bg-card p-5';

  const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Reports</h1>

      <section className={`${card} mt-8`}>
        <h2 className="font-display text-lg font-semibold">Generate a hiring report</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Opens a print-ready report — use the Download PDF button there to save it. Pick a month,
          or a custom range; leave both empty for the last 30 days.
        </p>
        <form action="/app/reports/print" className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="field-label">Role</label>
            <select name="opening" className="input w-56">
              <option value="all">All roles</option>
              {openings.map((o) => (
                <option key={o.id} value={o.id}>{o.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Month</label>
            <input type="month" name="month" className="input" />
          </div>
          <span className="pb-2 text-sm text-ink-soft">or</span>
          <div>
            <label className="field-label">From</label>
            <input type="date" name="from" className="input" />
          </div>
          <div>
            <label className="field-label">To</label>
            <input type="date" name="to" className="input" />
          </div>
          <button className="btn-primary">Open report</button>
        </form>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-display text-lg font-semibold">How far candidates get</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Candidates who ever reached each round, with conversion from applied.
          </p>
          <div className="overflow-x-auto"><table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="py-1 pr-3">Opening</th>
                <th className="py-1 pl-3 text-right">Applied</th>
                <th className="py-1 pl-3 text-right">Task</th>
                <th className="py-1 pl-3 text-right">Interview</th>
                <th className="py-1 pl-3 text-right">Offer</th>
                <th className="py-1 pl-3 text-right">Hired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reach.map((r) => (
                <tr key={r.opening_id}>
                  <td className="py-2 pr-3">{r.title}</td>
                  <td className="py-2 pl-3 text-right font-medium whitespace-nowrap">{r.applied}</td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">{r.task} <span className="text-xs text-ink-soft">({pct(r.task, r.applied)})</span></td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">{r.interview} <span className="text-xs text-ink-soft">({pct(r.interview, r.applied)})</span></td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">{r.offer}</td>
                  <td className="py-2 pl-3 text-right text-pine-deep whitespace-nowrap">{r.hired} <span className="text-xs text-ink-soft">({pct(r.hired, r.applied)})</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {reach.length === 0 && <p className="mt-2 text-sm text-ink-soft">No applications yet.</p>}
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Recent hiring activity</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {activity.map((ev, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  <Link href={`/app/candidates/${ev.app_id}`} className="font-medium hover:underline">
                    {ev.name}
                  </Link>{' '}
                  <span className="text-ink-soft">{ev.text}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-soft">{fmtDateTime(ev.when)}</span>
              </li>
            ))}
            {activity.length === 0 && <li className="text-ink-soft">No activity yet.</li>}
          </ul>
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Interview feedback by role</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {ratings.map((r) => (
              <li key={r.title} className="flex justify-between">
                <span>{r.title}</span>
                <span>
                  <span className="font-medium">★ {r.avg_rating}</span>
                  <span className="text-ink-soft"> · {r.n} rating(s)</span>
                </span>
              </li>
            ))}
            {ratings.length === 0 && <li className="text-ink-soft">No feedback recorded yet.</li>}
          </ul>
        </section>
        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Funnel by opening</h2>
          <div className="overflow-x-auto"><table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="py-1">Opening</th>
                <th className="py-1 text-right">Applied</th>
                <th className="py-1 text-right">Active</th>
                <th className="py-1 text-right">Hired</th>
                <th className="py-1 text-right">Rejected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {funnel.map((f) => (
                <tr key={f.opening_id}>
                  <td className="py-2">
                    <Link href={`/app/openings/${f.opening_id}/applications`} className="hover:underline">
                      {f.title}
                    </Link>
                  </td>
                  <td className="py-2 text-right font-medium">{f.total}</td>
                  <td className="py-2 text-right">{f.active}</td>
                  <td className="py-2 text-right text-pine-deep">{f.hired}</td>
                  <td className="py-2 text-right text-ink-soft">{f.rejected + f.withdrawn}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Where candidates come from</h2>
          <p className="mt-1 text-xs text-ink-soft">
            From utm_source on apply links — tag your Meta ads with ?utm_source=…&utm_campaign=…
          </p>
          <div className="overflow-x-auto"><table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="py-1">Source</th>
                <th className="py-1 text-right">Applications</th>
                <th className="py-1 text-right">Interviewed</th>
                <th className="py-1 text-right">Hired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sources.map((s) => (
                <tr key={s.source}>
                  <td className="py-2 font-medium">{s.source}</td>
                  <td className="py-2 text-right">{s.total}</td>
                  <td className="py-2 text-right">{s.interviews}</td>
                  <td className="py-2 text-right text-pine-deep">{s.hired}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Applications per week</h2>
          {weekly.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">No applications yet.</p>
          ) : (
            (() => {
              const W = 460;
              const H = 150;
              const padX = 26;
              const padTop = 22;
              const padBottom = 26;
              const x = (i: number) =>
                weekly.length === 1
                  ? W / 2
                  : padX + (i * (W - 2 * padX)) / (weekly.length - 1);
              const y = (count: number) =>
                H - padBottom - (count / maxWeekly) * (H - padTop - padBottom);
              const pts = weekly.map((w, i) => ({ ...w, cx: x(i), cy: y(w.count) }));
              return (
                <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img"
                  aria-label="Applications received per week">
                  {/* recessive baseline */}
                  <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom}
                    stroke="var(--color-line)" strokeWidth="1" />
                  <polyline
                    points={pts.map((p) => `${p.cx},${p.cy}`).join(' ')}
                    fill="none" stroke="var(--color-pine)" strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p) => (
                    <g key={p.week.toISOString()}>
                      <circle cx={p.cx} cy={p.cy} r="4" fill="var(--color-pine)"
                        stroke="var(--color-card)" strokeWidth="2">
                        <title>{`Week of ${p.week.toISOString().slice(0, 10)}: ${p.count} application(s)`}</title>
                      </circle>
                      <text x={p.cx} y={p.cy - 9} textAnchor="middle" fontSize="10"
                        fill="var(--color-ink-soft)">{p.count}</text>
                      <text x={p.cx} y={H - padBottom + 14} textAnchor="middle" fontSize="9"
                        fill="var(--color-ink-soft)">{p.week.toISOString().slice(5, 10)}</text>
                    </g>
                  ))}
                </svg>
              );
            })()
          )}
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Time to hire</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {tth.map((t) => (
              <li key={t.title} className="flex justify-between">
                <span>{t.title}</span>
                <span className="font-medium">{t.avg_days} days</span>
              </li>
            ))}
            {tth.length === 0 && <li className="text-ink-soft">No hires yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

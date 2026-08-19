import Link from 'next/link';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const [{ rows: funnel }, { rows: sources }, { rows: tth }, { rows: weekly }] = await Promise.all([
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
  ]);

  const maxWeekly = Math.max(1, ...weekly.map((w) => w.count));
  const card = 'rounded-lg border border-line bg-card p-5';

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Reports</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
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
          <div className="mt-4 flex h-32 items-end gap-2">
            {weekly.map((w) => (
              <div key={w.week.toISOString()} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs text-ink-soft">{w.count}</span>
                <div
                  className="w-full rounded-t bg-pine"
                  style={{ height: `${(w.count / maxWeekly) * 100}%` }}
                />
                <span className="text-[10px] text-ink-soft">
                  {w.week.toISOString().slice(5, 10)}
                </span>
              </div>
            ))}
            {weekly.length === 0 && <p className="text-sm text-ink-soft">No applications yet.</p>}
          </div>
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

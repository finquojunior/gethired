import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtSlot } from '@/lib/tz';
import ContinueChip from '@/components/ContinueChip';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [{ rows: interviews }, { rows: newApps }, { rows: pendingFeedback }, { rows: funnel }, { rows: [outbox] }] =
    await Promise.all([
      q<{ id: number; name: string; title: string; starts_at: Date; interviewer: string }>(
        `select a.id, a.name, o.title, sl.starts_at, p.full_name as interviewer
         from public.slots sl
         join public.applications a on a.id = sl.application_id
         join public.openings o on o.id = a.opening_id
         join public.profiles p on p.id = sl.interviewer_id
         where sl.starts_at between now() and now() + interval '24 hours' and a.status = 'active'
         order by sl.starts_at limit 10`
      ),
      q<{ opening_id: number; title: string; count: number }>(
        `select o.id as opening_id, o.title, count(*)::int as count
         from public.applications a join public.openings o on o.id = a.opening_id
         where a.created_at > now() - interval '7 days'
         group by o.id order by count desc`
      ),
      q<{ id: number; name: string; title: string; interviewer: string; starts_at: Date }>(
        `select distinct a.id, a.name, o.title, p.full_name as interviewer, sl.starts_at
         from public.slots sl
         join public.applications a on a.id = sl.application_id
         join public.openings o on o.id = a.opening_id
         join public.profiles p on p.id = sl.interviewer_id
         where sl.starts_at + make_interval(mins => sl.duration_mins) < now()
           and sl.starts_at > now() - interval '7 days'
           and a.status = 'active'
           and not exists (select 1 from public.feedback f
             where f.application_id = a.id and f.author_id = sl.interviewer_id)
         order by sl.starts_at desc limit 10`
      ),
      q<{ opening_id: number; title: string; stage: string; position: number; count: number }>(
        `select o.id as opening_id, o.title, s.name as stage, s.position, count(a.id)::int as count
         from public.openings o
         join public.stages s on s.opening_id = o.id
         left join public.applications a on a.current_stage_id = s.id and a.status = 'active'
         where o.status = 'open'
         group by o.id, s.id order by o.created_at desc, s.position`
      ),
      q<{ pending: number }>(
        `select count(*)::int as pending from public.email_log where status in ('pending', 'failed')`
      ),
    ]);

  const funnelByOpening = new Map<number, { title: string; stages: { stage: string; count: number }[] }>();
  for (const f of funnel) {
    if (!funnelByOpening.has(f.opening_id)) funnelByOpening.set(f.opening_id, { title: f.title, stages: [] });
    funnelByOpening.get(f.opening_id)!.stages.push({ stage: f.stage, count: f.count });
  }

  const card = 'rounded-lg border border-line bg-card p-5';
  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Today</h1>
      <ContinueChip />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Interviews in the next 24h</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {interviews.map((i) => (
              <li key={`${i.id}-${i.starts_at.getTime()}`} className="flex justify-between">
                <Link href={`/app/candidates/${i.id}`} className="font-medium hover:underline">
                  {i.name}
                </Link>
                <span className="text-ink-soft">
                  {i.title} · {fmtSlot(i.starts_at)} · {i.interviewer}
                </span>
              </li>
            ))}
            {interviews.length === 0 && <li className="text-ink-soft">No interviews scheduled.</li>}
          </ul>
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">New applications (7 days)</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {newApps.map((n) => (
              <li key={n.opening_id} className="flex justify-between">
                <Link href={`/app/openings/${n.opening_id}/applications`} className="hover:underline">
                  {n.title}
                </Link>
                <span className="font-medium">{n.count}</span>
              </li>
            ))}
            {newApps.length === 0 && <li className="text-ink-soft">No new applications this week.</li>}
          </ul>
        </section>

        <section className={card}>
          <h2 className="font-display text-lg font-semibold">Waiting on feedback</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {pendingFeedback.map((f) => (
              <li key={f.id} className="flex justify-between">
                <Link href={`/app/candidates/${f.id}`} className="font-medium hover:underline">
                  {f.name}
                </Link>
                <span className="text-ink-soft">
                  {f.title} · interviewed {fmtSlot(f.starts_at)} · {f.interviewer}
                </span>
              </li>
            ))}
            {pendingFeedback.length === 0 && <li className="text-ink-soft">All caught up.</li>}
          </ul>
        </section>

        <section className={card}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Email outbox</h2>
            <Link href="/app/emails" className="text-sm text-pine underline">View outbox</Link>
          </div>
          <p className="mt-3 text-sm">
            {outbox.pending > 0 ? (
              <span className="font-medium text-amber">{outbox.pending} email(s) waiting or failed</span>
            ) : (
              <span className="text-ink-soft">Nothing queued.</span>
            )}
          </p>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Open pipelines</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {[...funnelByOpening.entries()].map(([id, f]) => (
            <Link key={id} href={`/app/openings/${id}/applications`} className={`${card} hover:border-pine`}>
              <div className="font-medium">{f.title}</div>
              <div className="mt-2 flex gap-1">
                {f.stages.map((s) => (
                  <div key={s.stage} className="flex-1 text-center">
                    <div className="rounded bg-pine-wash py-1 text-sm font-semibold text-pine-deep">{s.count}</div>
                    <div className="mt-1 truncate text-xs text-ink-soft">{s.stage}</div>
                  </div>
                ))}
              </div>
            </Link>
          ))}
          {funnelByOpening.size === 0 && (
            <p className="text-sm text-ink-soft">No open roles. Open one from Openings.</p>
          )}
        </div>
      </section>
    </div>
  );
}

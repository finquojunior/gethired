import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, openingScope, scopeSql } from '@/lib/auth';
import Toaster from '@/components/Toaster';
import { fmtDay, fmtSlot } from '@/lib/tz';
import ContinueChip from '@/components/ContinueChip';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const user = await currentUser();
  const scope = await openingScope(user);
  const [
    { rows: interviews },
    { rows: newApps },
    { rows: pendingFeedback },
    { rows: funnel },
    { rows: [outbox] },
    { rows: [stats] },
    { rows: taskRound },
    { rows: stale },
    { rows: [{ n: toCloseCount }] },
  ] = await Promise.all([
      q<{ id: number; name: string; title: string; starts_at: Date; interviewer: string }>(
        `select a.id, a.name, o.title, sl.starts_at, p.full_name as interviewer
         from public.slots sl
         join public.applications a on a.id = sl.application_id
         join public.openings o on o.id = a.opening_id
         join public.profiles p on p.id = sl.interviewer_id
         where sl.starts_at between now() and now() + interval '24 hours' and a.status = 'active'
           and ${scopeSql('o.id', 1)}
         order by sl.starts_at limit 10`,
        [scope]
      ),
      q<{ opening_id: number; title: string; count: number }>(
        `select o.id as opening_id, o.title, count(*)::int as count
         from public.applications a join public.openings o on o.id = a.opening_id
         where a.created_at > now() - interval '7 days' and ${scopeSql('o.id', 1)}
         group by o.id order by count desc`,
        [scope]
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
           and ${scopeSql('o.id', 1)}
         order by sl.starts_at desc limit 10`,
        [scope]
      ),
      q<{ opening_id: number; title: string; stage: string; position: number; count: number }>(
        `select o.id as opening_id, o.title, s.name as stage, s.position, count(a.id)::int as count
         from public.openings o
         join public.stages s on s.opening_id = o.id
         left join public.applications a on a.current_stage_id = s.id and a.status = 'active'
         where o.status = 'open' and ${scopeSql('o.id', 1)}
         group by o.id, s.id order by o.created_at desc, s.position`,
        [scope]
      ),
      q<{ pending: number }>(
        `select count(*)::int as pending from public.email_log e join public.applications a on a.id = e.application_id
         where e.status in ('pending', 'failed') and ${scopeSql('a.opening_id', 1)}`,
        [scope]
      ),
      q<{ active: number; interviews7: number; offers: number; hired30: number }>(
        `select
           (select count(*)::int from public.applications where status = 'active' and ${scopeSql('opening_id', 1)}) as active,
           (select count(distinct sl.application_id)::int from public.slots sl
             join public.applications a on a.id = sl.application_id
             where sl.starts_at between now() and now() + interval '7 days' and a.status = 'active' and ${scopeSql('a.opening_id', 1)}) as interviews7,
           (select count(*)::int from public.applications a
             join public.stages s on s.id = a.current_stage_id
             where a.status = 'active' and s.kind = 'offer' and ${scopeSql('a.opening_id', 1)}) as offers,
           (select count(*)::int from public.applications
             where status = 'hired' and updated_at > now() - interval '30 days' and ${scopeSql('opening_id', 1)}) as hired30`,
        [scope]
      ),
      // task round: per opening, candidates in a task stage and how many have submitted
      q<{ opening_id: number; title: string; in_stage: number; submitted: number }>(
        `select o.id as opening_id, o.title,
                count(a.id)::int as in_stage,
                count(a.id) filter (where exists (
                  select 1 from public.submissions su
                  where su.application_id = a.id and su.stage_id = s.id))::int as submitted
         from public.stages s
         join public.openings o on o.id = s.opening_id
         join public.applications a on a.current_stage_id = s.id and a.status = 'active'
         where s.kind = 'task' and ${scopeSql('o.id', 1)}
         group by o.id order by in_stage desc`,
        [scope]
      ),
      // stale: active candidates with no stage movement for 14+ days
      q<{ id: number; name: string; title: string; stage: string; last_move: Date }>(
        `select a.id, a.name, o.title, s.name as stage,
                greatest(a.created_at, coalesce(
                  (select max(h.created_at) from public.stage_history h where h.application_id = a.id),
                  a.created_at)) as last_move
         from public.applications a
         join public.openings o on o.id = a.opening_id
         left join public.stages s on s.id = a.current_stage_id
         where a.status = 'active'
           and greatest(a.created_at, coalesce(
                 (select max(h.created_at) from public.stage_history h where h.application_id = a.id),
                 a.created_at)) < now() - interval '14 days'
           and ${scopeSql('o.id', 1)}
         order by last_move limit 10`,
        [scope]
      ),
      q<{ n: number }>(
        `select count(*)::int as n from public.slots sl
         join public.applications a on a.id = sl.application_id and a.status = 'active' and a.current_stage_id = sl.stage_id
         join public.openings o on o.id = a.opening_id
         where sl.completed_at is null and sl.starts_at <= now() and sl.starts_at > now() - interval '30 days' and ${scopeSql('o.id', 1)}`,
        [scope]
      ),
    ]);

  const funnelByOpening = new Map<number, { title: string; stages: { stage: string; count: number }[] }>();
  for (const f of funnel) {
    if (!funnelByOpening.has(f.opening_id)) funnelByOpening.set(f.opening_id, { title: f.title, stages: [] });
    funnelByOpening.get(f.opening_id)!.stages.push({ stage: f.stage, count: f.count });
  }

  const sectionTitle = 'font-display text-lg font-semibold';
  return (
    <div>
      <Toaster
        initial={e === 'forbidden' ? { kind: 'error', message: "You don't have access to that. Ask an admin to add you to the opening." } : null}
        cleanParams={['e']}
      />
      <h1 className="track font-display text-3xl font-bold">Dashboard</h1>
      <ContinueChip />

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Active candidates', value: stats.active },
          { label: 'Interviews next 7 days', value: stats.interviews7 },
          { label: 'At offer stage', value: stats.offers },
          { label: 'Hired (30 days)', value: stats.hired30 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent>
              <div className="font-display text-3xl font-semibold text-primary tabular-nums">{s.value}</div>
              <CardDescription className="mt-1 text-xs">{s.label}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className={sectionTitle}>Interviews in the next 24h</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {interviews.map((i) => (
                <li key={`${i.id}-${i.starts_at.getTime()}`} className="flex items-baseline justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/app/candidates/${i.id}`} className="block truncate font-medium hover:underline">
                      {i.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {i.title} · with {i.interviewer}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{fmtSlot(i.starts_at)}</span>
                </li>
              ))}
              {interviews.length === 0 && <li className="text-muted-foreground">No interviews scheduled.</li>}
            </ul>
            {toCloseCount > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                <Link href="/app/interviews" className="text-primary underline">{toCloseCount} held interview{toCloseCount === 1 ? '' : 's'} to close out</Link>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={sectionTitle}>New applications (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {newApps.map((n) => (
                <li key={n.opening_id} className="flex justify-between">
                  <Link href={`/app/openings/${n.opening_id}/applications`} className="hover:underline">
                    {n.title}
                  </Link>
                  <span className="font-medium">{n.count}</span>
                </li>
              ))}
              {newApps.length === 0 && <li className="text-muted-foreground">No new applications this week.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={sectionTitle}>Waiting on feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {pendingFeedback.map((f) => (
                <li key={f.id} className="flex justify-between">
                  <Link href={`/app/candidates/${f.id}`} className="font-medium hover:underline">
                    {f.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {f.title} · interviewed {fmtSlot(f.starts_at)} · {f.interviewer}
                  </span>
                </li>
              ))}
              {pendingFeedback.length === 0 && <li className="text-muted-foreground">All caught up.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={sectionTitle}>Task stage</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {taskRound.map((t) => (
                <li key={t.opening_id} className="flex justify-between">
                  <Link href={`/app/openings/${t.opening_id}/task`} className="hover:underline">
                    {t.title}
                  </Link>
                  <span>
                    <span className="font-medium text-primary">{t.submitted} submitted</span>
                    <span className="text-muted-foreground"> · {t.in_stage - t.submitted} awaiting</span>
                  </span>
                </li>
              ))}
              {taskRound.length === 0 && <li className="text-muted-foreground">Nobody in a task stage.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={sectionTitle}>Stuck for 14+ days</CardTitle>
            <CardDescription>Active candidates with no stage movement.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {stale.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <Link href={`/app/candidates/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {s.title} · {s.stage ?? '—'} · since {fmtDay(s.last_move)}
                  </span>
                </li>
              ))}
              {stale.length === 0 && <li className="text-muted-foreground">Nobody stuck — pipeline is moving.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={sectionTitle}>Email outbox</CardTitle>
            <CardAction>
              <Link href="/app/emails" className="text-sm text-primary underline">View outbox</Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {outbox.pending > 0 ? (
                <span className="font-medium text-amber">{outbox.pending} email(s) waiting or failed</span>
              ) : (
                <span className="text-muted-foreground">Nothing queued.</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className={sectionTitle}>Open pipelines</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {[...funnelByOpening.entries()].map(([id, f]) => (
            <Link key={id} href={`/app/openings/${id}/applications`} className="rounded-xl">
              <Card className="h-full transition-shadow hover:ring-primary/50">
                <CardContent>
                  <div className="font-medium">{f.title}</div>
                  <div className="mt-2 flex gap-1">
                    {f.stages.map((s) => (
                      <div key={s.stage} className="flex-1 text-center">
                        <div className="rounded bg-secondary py-1 text-sm font-semibold text-secondary-foreground tabular-nums">{s.count}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{s.stage}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {funnelByOpening.size === 0 && (
            <Empty className="lg:col-span-2">
              <EmptyHeader>
                <EmptyTitle>No open roles yet.</EmptyTitle>
                <EmptyDescription>
                  <Link href="/app/openings">Create an opening</Link>, publish its form, then set its status to open.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </section>
    </div>
  );
}

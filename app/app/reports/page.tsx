import Link from 'next/link';
import { q } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/tz';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  await requireStaff();
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
  const h2 = 'font-display text-lg font-semibold';

  const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Reports</h1>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className={h2}>Generate a hiring report</CardTitle>
          <CardDescription>Opens a print-ready report — use the Download PDF button there to save it. Pick a month,
          or a custom range; leave both empty for the last 30 days. If a month is set it wins over
          From/To.</CardDescription>
        </CardHeader>
        <CardContent>
        <form action="/app/reports/print" className="flex flex-wrap items-end gap-3">
          <Field className="w-56">
            <Label htmlFor="rep-opening">Role</Label>
            <NativeSelect id="rep-opening" name="opening">
              <NativeSelectOption value="all">All roles</NativeSelectOption>
              {openings.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>{o.title}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="w-44">
            <Label htmlFor="rep-month">Month</Label>
            <Input id="rep-month" type="month" name="month" />
          </Field>
          <span className="pb-2 text-sm text-muted-foreground">or</span>
          <Field className="w-44">
            <Label htmlFor="rep-from">From</Label>
            <Input id="rep-from" type="date" name="from" />
          </Field>
          <Field className="w-44">
            <Label htmlFor="rep-to">To</Label>
            <Input id="rep-to" type="date" name="to" />
          </Field>
          <Button type="submit">Open report</Button>
        </form>
      </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className={h2}>How far candidates get</CardTitle>
            <CardDescription>Candidates who ever reached each kind of stage, with conversion from applied.</CardDescription>
          </CardHeader>
          <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                <TableHead className="px-0">Opening</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead className="text-right">Task</TableHead>
                <TableHead className="text-right">Interview</TableHead>
                <TableHead className="text-right">Offer</TableHead>
                <TableHead className="text-right">Hired</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reach.map((r) => (
                <TableRow key={r.opening_id}>
                  <TableCell className="px-0 whitespace-normal">{r.title}</TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">{r.applied}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{r.task} <span className="text-xs text-muted-foreground">({pct(r.task, r.applied)})</span></TableCell>
                  <TableCell className="text-right whitespace-nowrap">{r.interview} <span className="text-xs text-muted-foreground">({pct(r.interview, r.applied)})</span></TableCell>
                  <TableCell className="text-right whitespace-nowrap">{r.offer}</TableCell>
                  <TableCell className="text-right text-primary whitespace-nowrap">{r.hired} <span className="text-xs text-muted-foreground">({pct(r.hired, r.applied)})</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {reach.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No applications yet.</p>}
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle className={h2}>Recent hiring activity</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="space-y-2 text-sm">
            {activity.map((ev, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  <Link href={`/app/candidates/${ev.app_id}`} className="font-medium hover:underline">
                    {ev.name}
                  </Link>{' '}
                  <span className="text-muted-foreground">{ev.text}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(ev.when)}</span>
              </li>
            ))}
            {activity.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
          </ul>
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle className={h2}>Interview feedback by role</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="space-y-2 text-sm">
            {ratings.map((r) => (
              <li key={r.title} className="flex justify-between">
                <span>{r.title}</span>
                <span>
                  <span className="font-medium">★ {r.avg_rating}</span>
                  <span className="text-muted-foreground"> · {r.n} rating(s)</span>
                </span>
              </li>
            ))}
            {ratings.length === 0 && <li className="text-muted-foreground">No feedback recorded yet.</li>}
          </ul>
        </CardContent>
      </Card>
        <Card>
          <CardHeader>
            <CardTitle className={h2}>Funnel by opening</CardTitle>
          </CardHeader>
          <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                <TableHead className="px-0">Opening</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Hired</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funnel.map((f) => (
                <TableRow key={f.opening_id}>
                  <TableCell className="px-0 whitespace-normal">
                    <Link href={`/app/openings/${f.opening_id}/applications`} className="hover:underline">
                      {f.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium">{f.total}</TableCell>
                  <TableCell className="text-right">{f.active}</TableCell>
                  <TableCell className="text-right text-primary">{f.hired}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{f.rejected + f.withdrawn}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle className={h2}>Where candidates come from</CardTitle>
            <CardDescription>From utm_source on apply links — tag your Meta ads with ?utm_source=…&utm_campaign=…</CardDescription>
          </CardHeader>
          <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                <TableHead className="px-0">Source</TableHead>
                <TableHead className="text-right">Applications</TableHead>
                <TableHead className="text-right">Interviewed</TableHead>
                <TableHead className="text-right">Hired</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => (
                <TableRow key={s.source}>
                  <TableCell className="font-medium">{s.source}</TableCell>
                  <TableCell className="text-right">{s.total}</TableCell>
                  <TableCell className="text-right">{s.interviews}</TableCell>
                  <TableCell className="text-right text-primary">{s.hired}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle className={h2}>Applications per week</CardTitle>
          </CardHeader>
          <CardContent>
          {weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
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
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
                  aria-label="Applications received per week">
                  {/* recessive baseline */}
                  <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom}
                    stroke="var(--border)" strokeWidth="1" />
                  <polyline
                    points={pts.map((p) => `${p.cx},${p.cy}`).join(' ')}
                    fill="none" stroke="var(--primary)" strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p) => (
                    <g key={p.week.toISOString()}>
                      <circle cx={p.cx} cy={p.cy} r="4" fill="var(--primary)"
                        stroke="var(--card)" strokeWidth="2">
                        <title>{`Week of ${fmtDate(p.week)}: ${p.count} application(s)`}</title>
                      </circle>
                      <text x={p.cx} y={p.cy - 9} textAnchor="middle" fontSize="10"
                        fill="var(--muted-foreground)">{p.count}</text>
                      <text x={p.cx} y={H - padBottom + 14} textAnchor="middle" fontSize="9"
                        fill="var(--muted-foreground)">{fmtDate(p.week).slice(5)}</text>
                    </g>
                  ))}
                </svg>
              );
            })()
          )}
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle className={h2}>Time to hire</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="space-y-2 text-sm">
            {tth.map((t) => (
              <li key={t.title} className="flex justify-between">
                <span>{t.title}</span>
                <span className="font-medium">{t.avg_days} days</span>
              </li>
            ))}
            {tth.length === 0 && <li className="text-muted-foreground">No hires yet.</li>}
          </ul>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

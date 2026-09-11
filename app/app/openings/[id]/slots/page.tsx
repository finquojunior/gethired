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
import { AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

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

  // per interview stage: candidates invited but not yet booked, and open future slots
  const { rows: interviewStages } = await q<{ id: number; name: string; waiting: number; open: number }>(
    `select s.id, s.name,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active'
                and not exists (select 1 from public.slots sl where sl.application_id = a.id and sl.stage_id = s.id)) as waiting,
            (select count(*)::int from public.slots sl
              where sl.stage_id = s.id and sl.application_id is null and sl.starts_at > now()) as open
     from public.stages s where s.opening_id = $1 and s.kind = 'interview' order by s.position`,
    [openingId]
  );
  const starved = interviewStages.filter((s) => s.waiting > 0 && s.open === 0);
  // who is waiting, by name: in an interview stage, active, no slot booked for that stage
  const { rows: waiting } = await q<{ id: number; name: string; email: string; stage: string; since: Date; open: number }>(
    `select a.id, a.name, a.email, s.name as stage,
            coalesce((select max(h.created_at) from public.stage_history h
                       where h.application_id = a.id and h.to_stage_id = s.id), a.created_at) as since,
            (select count(*)::int from public.slots sl
              where sl.stage_id = s.id and sl.application_id is null and sl.starts_at > now()) as open
     from public.applications a
     join public.stages s on s.id = a.current_stage_id
     where a.opening_id = $1 and a.status = 'active' and s.kind = 'interview'
       and not exists (select 1 from public.slots sl where sl.application_id = a.id and sl.stage_id = s.id)
     order by since`,
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
    completed_at: Date | null;
  }>(
    `select sl.id, sl.starts_at, sl.duration_mins, st.name as stage,
            p.full_name as interviewer, a.id as candidate_id, a.name as candidate, sl.completed_at,
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
        <Link href={`/app/openings/${openingId}`} className="text-muted-foreground hover:underline">
          {opening.title}
        </Link>{' '}
        · Interview slots
      </h1>
      <OpeningTabs openingId={openingId} current="slots" />

      {interviewStages.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This opening has no interview stage.{' '}
          <Link href={`/app/openings/${openingId}/stages`} className="text-primary underline">
            Add one in Stages
          </Link>{' '}
          first.
        </p>
      ) : (
        <>
        {starved.length > 0 && (
          <Alert variant="destructive" className="mt-6">
            <AlertTriangle />
            <AlertTitle>
              {starved
                .map((s) => `${s.waiting} candidate${s.waiting === 1 ? '' : 's'} in ${s.name} ${s.waiting === 1 ? 'has' : 'have'} the interview invite but there are no open slots to book`)
                .join('; ')}
              .
            </AlertTitle>
            <AlertDescription>Create slots below for this opening.</AlertDescription>
          </Alert>
        )}
        {waiting.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold">Waiting to book</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Invited to an interview stage but no slot booked yet — worth a nudge if slots are open.
            </p>
            <Card className="mt-2 py-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                    <TableHead className="px-4">Candidate</TableHead>
                    <TableHead className="px-4">Stage</TableHead>
                    <TableHead className="px-4">In stage since</TableHead>
                    <TableHead className="px-4">Open slots</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {waiting.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="px-4">
                        <Link href={`/app/candidates/${w.id}`} className="text-primary underline">{w.name}</Link>
                        <span className="text-muted-foreground"> · {w.email}</span>
                      </TableCell>
                      <TableCell className="px-4">{w.stage}</TableCell>
                      <TableCell className="px-4">{fmtDateTime(w.since)}</TableCell>
                      <TableCell className="px-4">
                        {w.open > 0 ? w.open : <Badge variant="destructive">none</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        )}
        <form action={createSlots} className="mt-8 flex flex-wrap items-end gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <input type="hidden" name="openingId" value={openingId} />
          <Field className="w-40">
            <Label htmlFor="slot-stage">Stage</Label>
            <NativeSelect id="slot-stage" name="stageId" >
              {interviewStages.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}{s.waiting > 0 ? ` — ${s.waiting} waiting to book` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="w-52">
            <Label htmlFor="slot-interviewer">Primary interviewer</Label>
            <NativeSelect id="slot-interviewer" name="interviewerId" required >
              {people.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>{p.full_name}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <fieldset className="min-w-48">
            <legend className="mb-1.5 text-sm leading-none font-medium">Panel (optional)</legend>
            <div className="flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-sm">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input type="checkbox" name="panelIds" value={p.id}  />
                  {p.full_name}
                </label>
              ))}
            </div>
          </fieldset>
          <Field className="w-40">
            <Label htmlFor="slot-date">Date</Label>
            <Input id="slot-date" type="date" name="date" required min={today}  />
          </Field>
          <Field className="w-28">
            <Label htmlFor="slot-from">From ({TZ_LABEL})</Label>
            <Input id="slot-from" type="time" name="from" required defaultValue="10:00"  />
          </Field>
          <Field className="w-28">
            <Label htmlFor="slot-to">To ({TZ_LABEL})</Label>
            <Input id="slot-to" type="time" name="to" required defaultValue="16:00"  />
          </Field>
          <Field className="w-24">
            <Label htmlFor="slot-duration">Minutes each</Label>
            <Input id="slot-duration" type="number" name="duration" defaultValue={30} min={5}  />
          </Field>
          <Field className="min-w-64 flex-1">
            <Label htmlFor="slot-link">Meeting link / location (sent to the candidate)</Label>
            <Input id="slot-link" name="meetingLink" placeholder="https://meet.google.com/… or office address" />
          </Field>
          <SubmitButton pendingLabel="Creating…">Create slots</SubmitButton>
          <p className="basis-full text-xs text-muted-foreground">
            One slot every &quot;minutes each&quot; between From and To. The primary interviewer and panel are
            emailed when a candidate books.
          </p>
        </form>
        </>
      )}

      <div className="mt-8 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{showPast ? 'All slots' : 'Upcoming slots'}</span>
        {showPast ? (
          <Link href={`/app/openings/${openingId}/slots`} className="text-primary underline">Hide past</Link>
        ) : pastCount > 0 ? (
          <Link href={`/app/openings/${openingId}/slots?past=1`} className="text-primary underline">
            Show past ({pastCount})
          </Link>
        ) : null}
      </div>

      <Card className="mt-2 py-0">
      <Table>
        <TableHeader>
          <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
            <TableHead className="px-4">When</TableHead>
            <TableHead className="px-4">Stage</TableHead>
            <TableHead className="px-4">Interviewer</TableHead>
            <TableHead className="px-4">Booked by</TableHead>
            <TableHead className="px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...byDay.entries()].flatMap(([day, rows]) => [
            <TableRow key={`day-${day}`} className="bg-muted/50 hover:bg-muted/50">
              <TableHead colSpan={5} scope="rowgroup" className="h-8 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {day} · {rows.length} slot{rows.length === 1 ? '' : 's'} · {rows.filter((r) => !r.candidate_id).length} open
              </TableHead>
            </TableRow>,
            ...rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="px-4">
                {fmtDateTime(s.starts_at)}
                <span className="text-muted-foreground"> · {s.duration_mins}m</span>
              </TableCell>
              <TableCell className="px-4">{s.stage}</TableCell>
              <TableCell className="px-4">
                {s.interviewer}
                {s.panel_names && <span className="text-muted-foreground"> + {s.panel_names}</span>}
              </TableCell>
              <TableCell className="px-4">
                {s.candidate_id ? (
                  <>
                    <Link href={`/app/candidates/${s.candidate_id}`} className="text-primary underline">
                      {s.candidate}
                    </Link>
                    {s.completed_at
                      ? <Badge variant="secondary" className="ml-2">Completed</Badge>
                      : s.starts_at <= new Date() && <Badge className="ml-2 bg-amber/15 text-amber">Awaiting completion</Badge>}
                  </>
                ) : (
                  <Badge variant="outline">open</Badge>
                )}
              </TableCell>
              <TableCell className="px-4 text-right">
                {!s.candidate_id && (
                  <form action={deleteSlot}>
                    <input type="hidden" name="openingId" value={openingId} />
                    <input type="hidden" name="slotId" value={s.id} />
                    <SubmitButton
                      variant="destructive"
                      size="sm"
                      pendingLabel="Deleting…"
                      confirmText={`Delete the ${fmtDateTime(s.starts_at)} slot?`}
                    >
                      Delete
                    </SubmitButton>
                  </form>
                )}
              </TableCell>
            </TableRow>
            )),
          ])}
          {slots.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="whitespace-normal p-0">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{showPast || pastCount === 0 ? 'No slots yet.' : 'No upcoming slots.'}</EmptyTitle>
                    <EmptyDescription>Create a batch above — candidates pick from open slots.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </Card>
    </div>
  );
}

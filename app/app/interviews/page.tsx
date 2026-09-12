import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, openingScope, scopeSql } from '@/lib/auth';
import { fmtClock, fmtDate, fmtDateTime } from '@/lib/tz';
import { approveReschedule, completeInterview, markNoShow, rejectReschedule } from '@/app/app/candidates/actions';
import CompleteInterviewButton from '@/components/CompleteInterviewButton';
import RescheduleDecision from '@/components/RescheduleDecision';
import SubmitButton from '@/components/SubmitButton';
import { pipelineFlash } from '@/app/app/candidates/flash';
import Flash from '@/components/Flash';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Interviews' };

const LIMIT = 50;

export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; e?: string }>;
}) {
  const { ok, e } = await searchParams;
  const scope = await openingScope(await currentUser());
  const [{ rows: upcoming }, { rows: openings }, { rows: toClose }, { rows: requests }, { rows: people }] = await Promise.all([
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
      reschedule_pending: boolean;
    }>(
      `select a.id, a.name as candidate, o.title, st.name as stage, sl.starts_at,
              sl.duration_mins, p.full_name as interviewer, sl.meeting_link,
              (select string_agg(pp.full_name, ', ') from public.profiles pp where pp.id = any(sl.panel)) as panel_names,
              exists (select 1 from public.reschedule_requests r where r.slot_id = sl.id and r.status = 'pending') as reschedule_pending
       from public.slots sl
       join public.applications a on a.id = sl.application_id
       join public.openings o on o.id = a.opening_id
       join public.stages st on st.id = sl.stage_id
       join public.profiles p on p.id = sl.interviewer_id
       where sl.starts_at > now() and a.status = 'active' and ${scopeSql('o.id', 1)}
       order by sl.starts_at limit ${LIMIT + 1}`,
      [scope]
    ),
    q<{ id: number; title: string; status: string; open_slots: number; booked: number }>(
      `select o.id, o.title, o.status,
              count(sl.id) filter (where sl.application_id is null and sl.starts_at > now())::int as open_slots,
              count(sl.id) filter (where sl.application_id is not null and sl.starts_at > now())::int as booked
       from public.openings o
       join public.stages s on s.opening_id = o.id and s.kind = 'interview'
       left join public.slots sl on sl.opening_id = o.id
       where o.status <> 'closed' and ${scopeSql('o.id', 1)}
       group by o.id
       order by o.created_at desc`,
      [scope]
    ),
    q<{ id: number; candidate: string; title: string; stage: string; starts_at: Date; slot_id: number; interviewer: string }>(
      `select a.id, a.name as candidate, o.title, st.name as stage, sl.starts_at, sl.id as slot_id, p.full_name as interviewer
       from public.slots sl
       join public.applications a on a.id = sl.application_id
       join public.openings o on o.id = a.opening_id
       join public.stages st on st.id = sl.stage_id
       join public.profiles p on p.id = sl.interviewer_id
       where sl.completed_at is null and sl.no_show_at is null and sl.starts_at <= now() and sl.starts_at > now() - interval '30 days'
         and a.status = 'active' and a.current_stage_id = sl.stage_id and ${scopeSql('o.id', 1)}
         and not exists (select 1 from public.reschedule_requests r where r.slot_id = sl.id and r.status = 'pending')
       order by sl.starts_at desc limit 50`,
      [scope]
    ),
    q<{ id: number; application_id: number; candidate: string; title: string; stage: string; requested_at: Date; note: string; created_at: Date; current_starts: Date | null; interviewer_id: string | null; duration_mins: number | null }>(
      `select r.id, r.application_id, a.name as candidate, o.title, st.name as stage, r.requested_at, r.note, r.created_at,
              sl.starts_at as current_starts, sl.interviewer_id, sl.duration_mins
       from public.reschedule_requests r
       join public.applications a on a.id = r.application_id
       join public.openings o on o.id = a.opening_id
       join public.stages st on st.id = r.stage_id
       left join public.slots sl on sl.id = r.slot_id
       where r.status = 'pending' and a.status = 'active' and ${scopeSql('o.id', 1)}
       order by r.created_at`,
      [scope]
    ),
    q<{ id: string; full_name: string }>(`select id, full_name from public.profiles order by full_name`),
  ]);
  const truncated = upcoming.length > LIMIT;
  if (truncated) upcoming.pop();
  const flash = pipelineFlash(ok, e);

  return (
    <div>
      <Flash kind={flash?.kind ?? 'success'} message={flash?.message} />
      <h1 className="track font-display text-3xl font-bold">Interviews</h1>

      {requests.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">Reschedule requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Candidates asking to move a booked interview. Their current slot stays booked until you decide.
            Approving creates a new slot at the agreed time and books them into it.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-amber/40">
                <span>
                  <Link href={`/app/candidates/${r.application_id}`} className="font-medium text-primary hover:underline">{r.candidate}</Link>
                  <span className="text-muted-foreground"> · {r.title} · {r.stage}</span>
                  <br />
                  <span className="text-muted-foreground">
                    {r.current_starts ? `booked ${fmtDateTime(r.current_starts)}` : 'no current booking'} → asks for{' '}
                  </span>
                  <span className="font-medium">{fmtDateTime(r.requested_at)}</span>
                  {r.note && <span className="text-muted-foreground"> · “{r.note}”</span>}
                </span>
                <RescheduleDecision
                  request={{
                    id: r.id,
                    applicationId: r.application_id,
                    candidateName: r.candidate,
                    currentWhen: r.current_starts ? fmtDateTime(r.current_starts) : null,
                    requestedLabel: fmtDateTime(r.requested_at),
                    requestedDate: fmtDate(r.requested_at),
                    requestedTime: fmtClock(r.requested_at),
                    note: r.note,
                    interviewerId: r.interviewer_id,
                    duration: r.duration_mins ?? 30,
                  }}
                  people={people}
                  approve={approveReschedule}
                  reject={rejectReschedule}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {toClose.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">To close out</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Held interviews not yet closed out. Mark one completed to rate it — the candidate then moves to Interview review.
            No show rejects the candidate and emails them.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {toClose.map((u) => (
              <li key={u.slot_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
                <span>
                  <Link href={`/app/candidates/${u.id}`} className="font-medium text-primary hover:underline">{u.candidate}</Link>
                  <span className="text-muted-foreground"> · {u.title} · {u.stage} · {fmtDateTime(u.starts_at)} · {u.interviewer}</span>
                </span>
                <span className="flex items-center gap-2">
                  <CompleteInterviewButton
                    action={completeInterview}
                    applicationId={u.id}
                    slotId={u.slot_id}
                    candidateName={u.candidate}
                    when={fmtDateTime(u.starts_at)}
                  />
                  <form action={markNoShow}>
                    <input type="hidden" name="applicationId" value={u.id} />
                    <input type="hidden" name="slotId" value={u.slot_id} />
                    <input type="hidden" name="back" value="/app/interviews" />
                    <SubmitButton variant="outline" size="sm" pendingLabel="Marking…"
                      confirmText={`Mark ${u.candidate} as a no-show for the ${fmtDateTime(u.starts_at)} interview? They will be rejected and emailed.`}>
                      No show
                    </SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Upcoming</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {upcoming.map((u, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
              <span>
                <Link href={`/app/candidates/${u.id}`} className="font-medium text-primary hover:underline">
                  {u.candidate}
                </Link>
                <span className="text-muted-foreground"> · {u.title} · {u.stage}</span>
                {u.reschedule_pending && <Badge className="ml-2 bg-amber/15 text-amber">reschedule requested</Badge>}
              </span>
              <span className="text-muted-foreground">
                {fmtDateTime(u.starts_at)} · {u.duration_mins}m · {u.interviewer}
                {u.panel_names && ` + ${u.panel_names}`}
                {u.meeting_link && /^https?:\/\//.test(u.meeting_link) && (
                  <>
                    {' · '}
                    <a href={u.meeting_link} target="_blank" rel="noopener" className="text-primary underline">
                      join
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
          {upcoming.length === 0 && (
            <li>
              <Empty className="border bg-card">
                <EmptyHeader>
                  <EmptyTitle>No upcoming interviews booked.</EmptyTitle>
                </EmptyHeader>
              </Empty>
            </li>
          )}
          {truncated && (
            <li className="px-4 py-2 text-center text-xs text-muted-foreground">
              Showing the next {LIMIT} — later ones appear as these pass.
            </li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Slots by opening</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create and manage interview slots per opening — candidates in an interview stage pick
          from the open ones.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {openings.map((o) => (
            <Link key={o.id} href={`/app/openings/${o.id}/slots`} className="rounded-xl">
              <Card size="sm" className="h-full transition-shadow hover:ring-primary/50">
                <CardContent>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{o.title}</span>
                    {o.open_slots === 0 && o.booked === 0 ? (
                      <Badge variant="outline" className="shrink-0 border-transparent bg-amber/15 text-amber">no slots</Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">{o.open_slots} open</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {o.booked} booked · {o.status}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {openings.length === 0 && (
            <Empty className="sm:col-span-2">
              <EmptyHeader>
                <EmptyTitle>No openings with an interview stage yet.</EmptyTitle>
                <EmptyDescription>Add one in an opening&apos;s Stages tab.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </section>
    </div>
  );
}

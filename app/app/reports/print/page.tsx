import { q } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/tz';
import PrintButton from '@/components/PrintButton';
import BackButton from '@/components/BackButton';

export const dynamic = 'force-dynamic';

// Period resolution: ?month=YYYY-MM wins, else ?from/?to (YYYY-MM-DD), else last 30 days.
function resolvePeriod(sp: { month?: string; from?: string; to?: string }): {
  start: Date;
  end: Date;
  label: string;
} {
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const start = new Date(`${sp.month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end, label: sp.month };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (sp.from && day.test(sp.from)) {
    const start = new Date(`${sp.from}T00:00:00Z`);
    const end = sp.to && day.test(sp.to) ? new Date(`${sp.to}T00:00:00Z`) : new Date();
    end.setUTCDate(end.getUTCDate() + 1); // inclusive "to"
    return { start, end, label: `${sp.from} → ${sp.to || 'today'}` };
  }
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  return { start, end, label: 'last 30 days' };
}

export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ opening?: string; month?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { start, end, label } = resolvePeriod(sp);
  const openingId = /^\d+$/.test(sp.opening ?? '') ? Number(sp.opening) : null;

  // openings with any applications, scoped when a single role is requested
  const { rows: openings } = await q<{ id: number; title: string; status: string }>(
    `select id, title, status from public.openings
     where ($1::bigint is null or id = $1)
       and exists (select 1 from public.applications a where a.opening_id = openings.id)
     order by created_at desc`,
    [openingId]
  );

  // activity counts in the period, per opening
  const { rows: counts } = await q<{
    opening_id: number;
    applied: number;
    to_task: number;
    submitted: number;
    interviews: number;
    to_offer: number;
    hired: number;
    rejected: number;
    withdrawn: number;
  }>(
    `select o.id as opening_id,
            (select count(*)::int from public.applications a
              where a.opening_id = o.id and a.created_at >= $2 and a.created_at < $3) as applied,
            (select count(distinct h.application_id)::int from public.stage_history h
              join public.applications a on a.id = h.application_id
              join public.stages s on s.id = h.to_stage_id
              where a.opening_id = o.id and s.kind = 'task'
                and h.created_at >= $2 and h.created_at < $3) as to_task,
            (select count(distinct su.application_id)::int from public.submissions su
              join public.applications a on a.id = su.application_id
              where a.opening_id = o.id and su.created_at >= $2 and su.created_at < $3) as submitted,
            (select count(distinct sl.application_id)::int from public.slots sl
              join public.applications a on a.id = sl.application_id
              where a.opening_id = o.id and sl.application_id is not null
                and sl.starts_at >= $2 and sl.starts_at < $3) as interviews,
            (select count(distinct h.application_id)::int from public.stage_history h
              join public.applications a on a.id = h.application_id
              join public.stages s on s.id = h.to_stage_id
              where a.opening_id = o.id and s.kind = 'offer'
                and h.created_at >= $2 and h.created_at < $3) as to_offer,
            (select count(*)::int from public.applications a
              where a.opening_id = o.id and a.status = 'hired'
                and a.updated_at >= $2 and a.updated_at < $3) as hired,
            (select count(*)::int from public.applications a
              where a.opening_id = o.id and a.status = 'rejected'
                and a.updated_at >= $2 and a.updated_at < $3) as rejected,
            (select count(*)::int from public.applications a
              where a.opening_id = o.id and a.status = 'withdrawn'
                and a.updated_at >= $2 and a.updated_at < $3) as withdrawn
     from public.openings o
     where ($1::bigint is null or o.id = $1)`,
    [openingId, start.toISOString(), end.toISOString()]
  );
  const countsByOpening = new Map(counts.map((c) => [c.opening_id, c]));

  // candidates with any activity in the period: applied, moved stage, or reached an outcome
  const { rows: candidates } = await q<{
    opening_id: number;
    id: number;
    name: string;
    status: string;
    current_stage: string | null;
    applied_at: Date;
    task_submitted: Date | null;
    interview_at: Date | null;
    decided_at: Date;
  }>(
    `select a.opening_id, a.id, a.name, a.status, cs.name as current_stage,
            a.created_at as applied_at,
            (select max(su.created_at) from public.submissions su where su.application_id = a.id) as task_submitted,
            (select min(sl.starts_at) from public.slots sl where sl.application_id = a.id) as interview_at,
            a.updated_at as decided_at
     from public.applications a
     left join public.stages cs on cs.id = a.current_stage_id
     where ($1::bigint is null or a.opening_id = $1)
       and (
         (a.created_at >= $2 and a.created_at < $3)
         or (a.updated_at >= $2 and a.updated_at < $3)
         or exists (select 1 from public.stage_history h
              where h.application_id = a.id and h.created_at >= $2 and h.created_at < $3)
       )
     order by a.opening_id, a.created_at`,
    [openingId, start.toISOString(), end.toISOString()]
  );
  const candidatesByOpening = new Map<number, typeof candidates>();
  for (const c of candidates) {
    if (!candidatesByOpening.has(c.opening_id)) candidatesByOpening.set(c.opening_id, []);
    candidatesByOpening.get(c.opening_id)!.push(c);
  }

  // selection timeline: every pipeline event in the period, chronological
  const { rows: events } = await q<{
    when: Date;
    name: string;
    title: string;
    kind: string;
    detail: string | null;
  }>(
    `select a.created_at as when, a.name, o.title, 'applied' as kind, null as detail
     from public.applications a join public.openings o on o.id = a.opening_id
     where ($1::bigint is null or a.opening_id = $1) and a.created_at >= $2 and a.created_at < $3
     union all
     select h.created_at, a.name, o.title, 'moved', s.name
     from public.stage_history h
     join public.applications a on a.id = h.application_id
     join public.openings o on o.id = a.opening_id
     left join public.stages s on s.id = h.to_stage_id
     where ($1::bigint is null or a.opening_id = $1) and h.created_at >= $2 and h.created_at < $3
     union all
     select a.updated_at, a.name, o.title, a.status, null
     from public.applications a join public.openings o on o.id = a.opening_id
     where ($1::bigint is null or a.opening_id = $1) and a.status in ('hired', 'rejected', 'withdrawn')
       and a.updated_at >= $2 and a.updated_at < $3
     order by 1 limit 300`,
    [openingId, start.toISOString(), end.toISOString()]
  );

  const eventText = (e: (typeof events)[number]) =>
    e.kind === 'applied'
      ? 'applied'
      : e.kind === 'moved'
        ? `moved to ${e.detail ?? 'a removed stage'}`
        : e.kind;

  const scope = openingId ? openings[0]?.title ?? 'Unknown role' : 'All roles';
  const outcomeStyle: Record<string, string> = {
    hired: 'text-pine-deep',
    rejected: 'text-rust',
    withdrawn: 'text-ink-soft',
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <BackButton fallback="/app/reports" />
        <PrintButton>Download PDF</PrintButton>
      </div>

      <header className="mt-4 border-b border-line pb-4">
        <h1 className="track font-display text-3xl font-bold">Hiring report</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {scope} · {label} · generated {fmtDateTime(new Date())}
        </p>
        <p className="text-xs text-ink-soft">
          Contains candidate personal data — for internal use only.
        </p>
      </header>

      {openings.map((o) => {
        const c = countsByOpening.get(o.id);
        const list = candidatesByOpening.get(o.id) ?? [];
        if (!c || (c.applied + c.to_task + c.interviews + c.hired + c.rejected + list.length === 0)) {
          return null;
        }
        return (
          <section key={o.id} className="mt-8 break-inside-avoid-page">
            <h2 className="font-display text-xl font-semibold">
              {o.title} <span className="text-sm font-normal text-ink-soft">({o.status})</span>
            </h2>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center md:grid-cols-8">
              {[
                ['Applied', c.applied],
                ['To task', c.to_task],
                ['Submitted', c.submitted],
                ['Interviews', c.interviews],
                ['To offer', c.to_offer],
                ['Hired', c.hired],
                ['Rejected', c.rejected],
                ['Withdrawn', c.withdrawn],
              ].map(([label2, n]) => (
                <div key={label2} className="rounded border border-line p-2">
                  <div className="font-display text-lg font-bold">{n}</div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-soft">{label2}</div>
                </div>
              ))}
            </div>

            {list.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                      <th className="py-1 pr-3">Candidate</th>
                      <th className="py-1 pr-3">Applied</th>
                      <th className="py-1 pr-3">Task submitted</th>
                      <th className="py-1 pr-3">First interview</th>
                      <th className="py-1">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.map((cand) => (
                      <tr key={cand.id}>
                        <td className="py-1.5 pr-3 font-medium">{cand.name}</td>
                        <td className="py-1.5 pr-3">{fmtDate(cand.applied_at)}</td>
                        <td className="py-1.5 pr-3">
                          {cand.task_submitted ? fmtDate(cand.task_submitted) : '—'}
                        </td>
                        <td className="py-1.5 pr-3">
                          {cand.interview_at ? fmtDate(cand.interview_at) : '—'}
                        </td>
                        <td className={`py-1.5 ${outcomeStyle[cand.status] ?? ''}`}>
                          {cand.status === 'active'
                            ? `in pipeline · ${cand.current_stage ?? '—'}`
                            : `${cand.status} · ${fmtDate(cand.decided_at)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {openings.length === 0 && (
        <p className="mt-8 text-sm text-ink-soft">No hiring data for this selection.</p>
      )}

      {events.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Selection timeline</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 text-xs text-ink-soft">{fmtDateTime(e.when)}</span>
                <span>
                  <span className="font-medium">{e.name}</span>{' '}
                  <span className={outcomeStyle[e.kind] ?? 'text-ink-soft'}>{eventText(e)}</span>{' '}
                  <span className="text-ink-soft">· {e.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import { fmtDate } from '@/lib/tz';
import SubmitButton from '@/components/SubmitButton';
import SelectAll, { SelectedCount } from '@/components/SelectAll';
import BulkProgress from '@/components/BulkProgress';
import Flash from '@/components/Flash';
import DownloadLink from '@/components/DownloadLink';
import OpeningTabs from '@/components/OpeningTabs';
import { bulkPipeline } from '@/app/app/candidates/actions';
import { pipelineFlash } from '@/app/app/candidates/flash';
import BoardView from './BoardView';
import {
  FEEDBACK_JOIN,
  PIPELINE_SORTS as SORTS,
  PIPELINE_WHERE,
  pipelineCtxParams,
  pipelineWhereParams,
} from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Pipeline` : 'Pipeline' };
}

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    stage?: string; status?: string; from?: string; to?: string; view?: string; sort?: string; q?: string;
    ok?: string; e?: string; imported?: string; skipped?: string;
  }>;
}) {
  const { id } = await params;
  const { stage, status = 'active', from = '', to = '', view, sort = 'score', q: term = '', ok, e, imported, skipped } =
    await searchParams;
  const board = view === 'board';
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string; status: string; slug: string; published: boolean }>(
    `select title, status, slug,
            exists (select 1 from public.forms f where f.opening_id = o.id and f.is_published) as published
     from public.openings o where id = $1`,
    [openingId]
  );
  if (!opening) notFound();
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();

  const { rows: stages } = await q<{ id: number; name: string; kind: string; count: number }>(
    `select s.id, s.name, s.kind,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as count
     from public.stages s where s.opening_id = $1 order by s.position`,
    [openingId]
  );

  // dead-end guard: interview stages someone could be moved into with no open slots
  const { rows: dryStages } = await q<{ name: string }>(
    `select s.name from public.stages s
     where s.opening_id = $1 and s.kind = 'interview'
       and not exists (
         select 1 from public.slots sl
         where sl.stage_id = s.id and sl.application_id is null and sl.starts_at > now()
       )`,
    [openingId]
  );

  const stageId = stage ? Number(stage) : null;
  const ctx = { stage, status, from, to, sort, q: term };
  const { rows: apps } = await q<{
    id: number;
    name: string;
    email: string;
    score: string | null;
    max_score: string | null;
    version: number;
    stage: string | null;
    stage_id: number | null;
    status: string;
    created_at: Date;
    avg_rating: string | null;
    rating_count: number | null;
  }>(
    `select a.id, a.name, a.email, a.score, a.max_score, f.version, s.name as stage,
            a.current_stage_id as stage_id, a.status, a.created_at,
            fb.avg_rating, fb.rating_count
     from public.applications a
     join public.forms f on f.id = a.form_id
     left join public.stages s on s.id = a.current_stage_id
     ${FEEDBACK_JOIN}
     where ${PIPELINE_WHERE}
     order by ${SORTS[sort] ?? SORTS.score}`,
    pipelineWhereParams(openingId, ctx)
  );
  const ctxQs = pipelineCtxParams(openingId, ctx);
  const base = `/app/openings/${openingId}/applications`;
  // this page's own query string, for the view toggle and the post-action redirect
  const listQs = new URLSearchParams(
    Object.entries({ stage, status: status !== 'active' ? status : '', from, to, sort: sort !== 'score' ? sort : '', q: term })
      .filter(([, v]) => v) as [string, string][]
  );
  const withView = (v?: string) => {
    const p = new URLSearchParams(listQs);
    if (v) p.set('view', v);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const backHref = withView(board ? 'board' : undefined);
  const flash =
    pipelineFlash(ok, e) ??
    (imported != null
      ? {
          kind: 'success' as const,
          message: `Imported ${imported} candidate${imported === '1' ? '' : 's'}${
            Number(skipped) > 0 ? `; skipped ${skipped} (bad email or already in this pipeline)` : ''
          }`,
        }
      : null);

  const tab = (href: string, label: string, active: boolean, count?: number) => (
    <Link
      key={href}
      href={href}
      className={`rounded-full px-3 py-1 text-sm ${
        active ? 'bg-ink text-white' : 'bg-card text-ink-soft border border-line hover:border-pine'
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
    </Link>
  );

  return (
    <div>
      <Flash kind={flash?.kind ?? 'success'} message={flash?.message} cleanParams={['ok', 'e', 'imported', 'skipped']} />
      <BackButton fallback={`/app/openings/${openingId}`} />
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">
          <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
            {opening.title}
          </Link>{' '}
          · Pipeline
        </h1>
        <div className="mb-1 flex gap-2">
          <Link href={`${base}/new`} className="btn-primary">Add candidate</Link>
          <DownloadLink href={`${base}/export`} preparingLabel="Preparing CSV…">Download CSV</DownloadLink>
        </div>
      </div>
      <OpeningTabs openingId={openingId} current="pipeline" />

      {imported != null && (
        <p className="mt-4 rounded-md bg-pine-wash px-4 py-3 text-sm text-pine-deep">
          Imported {imported} candidate{imported === '1' ? '' : 's'}
          {Number(skipped) > 0 && ` · skipped ${skipped} row${skipped === '1' ? '' : 's'} with a missing name, bad email, or an email already in this pipeline`}
          .
        </p>
      )}

      {dryStages.length > 0 && (
        <p className="mt-4 rounded-md bg-amber/15 px-4 py-3 text-sm text-amber">
          {dryStages.map((s) => s.name).join(', ')} has no open interview slots — candidates moved
          there will be invited to book but find nothing.{' '}
          <Link href={`/app/openings/${openingId}/slots`} className="underline">Create slots</Link>
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {tab(withView(board ? undefined : 'board'), board ? 'List view' : 'Board view', false)}
        <span className="mx-1 text-line">|</span>
        {tab(base, 'All active', !board && !stageId && status === 'active')}
        {stages.map((s) =>
          tab(`${base}?stage=${s.id}`, s.name, stageId === s.id && status === 'active', s.count)
        )}
        <span className="mx-2 text-line">|</span>
        {tab(`${base}?status=rejected`, 'Rejected', status === 'rejected')}
        {tab(`${base}?status=hired`, 'Hired', status === 'hired')}
        {tab(`${base}?status=withdrawn`, 'Withdrawn', status === 'withdrawn')}
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-2 text-sm">
        {stage && <input type="hidden" name="stage" value={stage} />}
        {status !== 'active' && <input type="hidden" name="status" value={status} />}
        {board && <input type="hidden" name="view" value="board" />}
        <div className="min-w-48 flex-1">
          <label className="field-label" htmlFor="q">Name or email</label>
          <input id="q" type="search" name="q" defaultValue={term} placeholder="Search this pipeline…" className="input py-1.5" />
        </div>
        <div>
          <label className="field-label" htmlFor="from">Applied from</label>
          <input id="from" type="date" name="from" defaultValue={from} className="input w-40 py-1.5" />
        </div>
        <div>
          <label className="field-label" htmlFor="to">to</label>
          <input id="to" type="date" name="to" defaultValue={to} className="input w-40 py-1.5" />
        </div>
        <div>
          <label className="field-label" htmlFor="sort">Sort by</label>
          <select id="sort" name="sort" defaultValue={sort} className="input w-36 py-1.5">
            <option value="score">Form score</option>
            <option value="feedback">Feedback</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
          </select>
        </div>
        <button className="btn-quiet">Apply</button>
        {(from || to || term || sort !== 'score') && (
          <Link href={base} className="pb-2 text-ink-soft underline">clear</Link>
        )}
      </form>

      {board ? (
        <BoardView
          openingId={openingId}
          ctxQs={ctxQs}
          stages={stages}
          dryStages={dryStages.map((s) => s.name)}
          cards={apps.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            score: a.score,
            max_score: a.max_score,
            stageId: a.stage_id,
          }))}
        />
      ) : (
      <form action={bulkPipeline} className="mt-6">
        <input type="hidden" name="openingId" value={openingId} />
        <input type="hidden" name="back" value={backHref} />
        <div className="overflow-x-auto rounded-lg border border-line bg-card"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="w-10 px-4 py-3"><SelectAll name="appId" /></th>
              <th className="px-4 py-3">Candidate</th>
              <th className="px-4 py-3">Form score</th>
              <th className="px-4 py-3">Feedback</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {apps.map((a) => (
              <tr key={a.id} className="hover:bg-paper">
                <td className="px-4 py-3">
                  <input type="checkbox" name="appId" value={a.id} className="accent-pine" />
                </td>
                <td className="p-0">
                  <Link
                    href={`/app/candidates/${a.id}?${ctxQs}`}
                    className="block px-4 py-3"
                    title="Open candidate profile"
                  >
                    <span className="font-medium text-pine hover:underline">{a.name} →</span>
                    <span className="block text-ink-soft">{a.email}</span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {a.score != null && Number(a.max_score) > 0
                    ? `${a.score} / ${a.max_score}`
                    : (a.score ?? '—')}
                  <span className="ml-1.5 text-xs text-ink-soft">v{a.version}</span>
                </td>
                <td className="px-4 py-3">
                  {a.avg_rating != null ? (
                    <>
                      <span className="text-amber">{'★'.repeat(Math.round(Number(a.avg_rating)))}</span>
                      <span className="ml-1.5 text-xs text-ink-soft">
                        {Number(a.avg_rating).toFixed(1)} ({a.rating_count})
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">{a.stage ?? '—'}</td>
                <td className="px-4 py-3 text-ink-soft">{fmtDate(a.created_at)}</td>
              </tr>
            ))}
            {apps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-soft">
                  {term || from || to || stageId || status !== 'active' ? (
                    <>
                      No candidates match these filters.{' '}
                      <Link href={base} className="text-pine underline">Show all active</Link>
                    </>
                  ) : opening.status !== 'open' ? (
                    <>
                      No candidates yet — this opening is <strong>{opening.status}</strong>, so nobody can apply.{' '}
                      {!opening.published && (
                        <>
                          <Link href={`/app/openings/${openingId}/form`} className="text-pine underline">Publish the form</Link>, then{' '}
                        </>
                      )}
                      <Link href={`/app/openings/${openingId}`} className="text-pine underline">set the status to open</Link>, or{' '}
                      <Link href={`${base}/new`} className="text-pine underline">add a candidate by hand</Link>.
                    </>
                  ) : (
                    <>
                      No applications yet. Share{' '}
                      <a href={`/careers/${opening.slug}`} target="_blank" rel="noopener" className="text-pine underline">
                        /careers/{opening.slug}
                      </a>{' '}
                      or <Link href={`${base}/new`} className="text-pine underline">add a candidate by hand</Link>.
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table></div>

        {apps.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-4 py-3 text-sm">
            <BulkProgress />
            <SelectedCount name="appId" />
            <span className="text-ink-soft">·</span>
            <label className="sr-only" htmlFor="bulkStage">Stage to move to</label>
            <select id="bulkStage" name="stageId" className="input w-44 py-1.5">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{dryStages.some((d) => d.name === s.name) ? ' (no open slots!)' : ''}
                </option>
              ))}
            </select>
            <SubmitButton
              name="intent"
              value="move"
              className="btn-quiet"
              pendingLabel="Moving…"
              confirmText="Move {n} candidate(s) to {stage}?"
              confirmMin={dryStages.length > 0 ? 1 : 2}
            >
              Move to stage
            </SubmitButton>
            <label className="flex items-center gap-1.5 text-xs text-ink-soft">
              <input type="checkbox" name="notify" value="1" defaultChecked className="accent-pine" />
              Email the candidate about this move
            </label>
            <div className="mx-2 h-5 w-px bg-line" />
            {status === 'active' ? (
              <>
                <SubmitButton name="intent" value="hire" className="btn-quiet text-pine-deep" pendingLabel="Hiring…" confirmText="Mark {n} candidate(s) as hired? They will each get the congratulations email.">Mark hired</SubmitButton>
                <SubmitButton name="intent" value="reject_send" className="btn-danger" pendingLabel="Rejecting…" confirmText="Reject {n} candidate(s) and email them now? This cannot be undone quietly — the email goes out immediately.">Reject + email now</SubmitButton>
                <SubmitButton name="intent" value="reject_draft" className="btn-danger" pendingLabel="Rejecting…" confirmText="Reject {n} candidate(s)? The rejection email is drafted in Emails for you to send later." title="Rejects and drafts the email — send it manually from the Emails tab">Reject + draft email</SubmitButton>
                <SubmitButton name="intent" value="withdraw" className="btn-quiet" pendingLabel="Updating…" confirmText="Mark {n} candidate(s) as withdrawn? No email is sent." title="For candidates who told you they are no longer interested">Mark withdrawn</SubmitButton>
              </>
            ) : (
              <SubmitButton name="intent" value="restore" className="btn-quiet" pendingLabel="Restoring…">Restore to active</SubmitButton>
            )}
          </div>
        )}
        {apps.length > 0 && (
          <p className="mt-2 text-xs text-ink-soft">
            With the email box ticked, a move into a task or interview stage sends the candidate
            their instructions and portal link, and a move forward into any other stage sends a
            short progress update. Moves backwards or sideways never email. Untick the box to move
            silently. &quot;Reject + email now&quot; sends immediately; &quot;Reject + draft email&quot;
            parks the mail in <Link href="/app/emails" className="underline">Emails</Link> until you
            send it; &quot;Mark withdrawn&quot; never emails.
          </p>
        )}
      </form>
      )}
    </div>
  );
}

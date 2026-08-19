import Link from 'next/link';
import { q } from '@/lib/db';
import SubmitButton from '@/components/SubmitButton';
import { createOpening } from './actions';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-line text-ink-soft',
  open: 'bg-pine-wash text-pine-deep',
  paused: 'bg-amber/15 text-amber',
  closed: 'bg-rust/10 text-rust',
};

export const dynamic = 'force-dynamic';

export default async function OpeningsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const closed = show === 'closed';
  const { rows: openings } = await q<{
    id: number;
    title: string;
    department: string;
    status: string;
    applications: string;
  }>(
    `select o.id, o.title, o.department, o.status,
            count(a.id) as applications
     from public.openings o
     left join public.applications a on a.opening_id = o.id
     where (o.status = 'closed') = $1
     group by o.id
     order by o.created_at desc`,
    [closed]
  );

  return (
    <div>
      <div className="track flex items-end justify-between">
        <h1 className="font-display text-3xl font-bold">Openings</h1>
        <div className="flex gap-2 pb-1 text-sm">
          <Link
            href="/app/openings"
            className={`rounded-full px-3 py-1 ${!closed ? 'bg-ink text-white' : 'border border-line bg-card text-ink-soft'}`}
          >
            Active
          </Link>
          <Link
            href="/app/openings?show=closed"
            className={`rounded-full px-3 py-1 ${closed ? 'bg-ink text-white' : 'border border-line bg-card text-ink-soft'}`}
          >
            Closed
          </Link>
        </div>
      </div>

      <form action={createOpening} className="mt-8 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="field-label" htmlFor="title">New opening</label>
          <input id="title" name="title" required placeholder="e.g. Performance Marketer" className="input" />
        </div>
        <div className="w-48">
          <label className="field-label" htmlFor="department">Department</label>
          <input id="department" name="department" placeholder="Marketing" className="input" />
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Creating…">Create opening</SubmitButton>
      </form>

      <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-card">
        {openings.map((o) => (
          <li key={o.id}>
            <Link
              href={`/app/openings/${o.id}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 hover:bg-paper sm:px-5"
            >
              <div>
                <div className="font-medium">{o.title}</div>
                <div className="text-sm text-ink-soft">{o.department || '—'}</div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-ink-soft">{o.applications} applications</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status]}`}>
                  {o.status}
                </span>
              </div>
            </Link>
          </li>
        ))}
        {openings.length === 0 && (
          <li className="px-5 py-10 text-center text-sm text-ink-soft">
            No openings yet. Create the first one above.
          </li>
        )}
      </ul>
    </div>
  );
}

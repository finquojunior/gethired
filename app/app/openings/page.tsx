import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, departmentScope, isStaff, openingScope, scopeSql } from '@/lib/auth';
import Flash from '@/components/Flash';
import SubmitButton from '@/components/SubmitButton';
import { createOpening } from './actions';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-line text-ink-soft',
  open: 'bg-pine-wash text-pine-deep',
  paused: 'bg-amber/15 text-amber',
  closed: 'bg-rust/10 text-rust',
};

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Openings' };

export default async function OpeningsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; e?: string }>;
}) {
  const { show, e } = await searchParams;
  const closed = show === 'closed';
  const user = await currentUser();
  const scope = await openingScope(user);
  const myDepartments = await departmentScope(user); // null = any
  const { rows: departments } = await q<{ name: string }>(`select name from public.departments order by name`);
  const creatable = myDepartments === null ? departments.map((d) => d.name) : myDepartments;
  const canCreate = isStaff(user) || creatable.length > 0;
  const ERR: Record<string, string> = {
    department: 'Pick a department from the list — you can only create openings in your own departments.',
    title: 'Give the opening a title.',
  };
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
     where (o.status = 'closed') = $1 and ${scopeSql('o.id', 2)}
     group by o.id
     order by o.created_at desc`,
    [closed, scope]
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

      {e && ERR[e] && <Flash kind="error" message={ERR[e]} cleanParams={['e']} />}
      {canCreate && (
      <form action={createOpening} className="mt-8 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="field-label" htmlFor="title">New opening *</label>
          <input id="title" name="title" required placeholder="e.g. Performance Marketer" className="input" />
        </div>
        <div className="w-52">
          <label className="field-label" htmlFor="department">Department{isStaff(user) ? '' : ' *'}</label>
          <select id="department" name="department" className="input" required={!isStaff(user)} defaultValue={creatable.length === 1 ? creatable[0] : ''}>
            {isStaff(user) && <option value="">— none —</option>}
            {creatable.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Creating…">Create opening</SubmitButton>
        {isStaff(user) && departments.length === 0 && (
          <p className="w-full text-xs text-ink-soft">No departments yet — add them on the <Link href="/app/team" className="text-pine underline">Team</Link> page.</p>
        )}
      </form>
      )}

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
                <span className="text-ink-soft">{o.applications} candidate{o.applications === '1' ? '' : 's'}</span>
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

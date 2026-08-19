import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import SubmitButton from '@/components/SubmitButton';
import { addMember, removeMember } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();

  const { rows: members } = await q<{
    user_id: string;
    member_role: string;
    full_name: string;
    role: string;
  }>(
    `select m.user_id, m.member_role, p.full_name, p.role
     from public.opening_members m join public.profiles p on p.id = m.user_id
     where m.opening_id = $1 order by p.full_name`,
    [openingId]
  );
  const { rows: people } = await q<{ id: string; full_name: string; role: string }>(
    `select id, full_name, role from public.profiles order by full_name`
  );

  return (
    <div>
      <BackButton fallback={`/app/openings/${openingId}`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Team
      </h1>
      <p className="mt-4 text-sm text-ink-soft">
        Admins and HR see everything. Requesters and viewers see this opening&apos;s candidates;
        interviewers see only candidates booked into their slots.
      </p>

      <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-card">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between px-5 py-3">
            <div>
              <span className="font-medium">{m.full_name}</span>
              <span className="ml-2 text-sm text-ink-soft">{m.role}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-pine-wash px-2.5 py-0.5 text-xs font-medium text-pine-deep">
                {m.member_role}
              </span>
              <form action={removeMember}>
                <input type="hidden" name="openingId" value={openingId} />
                <input type="hidden" name="userId" value={m.user_id} />
                <SubmitButton className="text-sm text-rust hover:underline" pendingLabel="…">Remove</SubmitButton>
              </form>
            </div>
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-ink-soft">
            No one assigned yet. Add the requester and interviewers below.
          </li>
        )}
      </ul>

      <form action={addMember} className="mt-6 flex items-end gap-2">
        <input type="hidden" name="openingId" value={openingId} />
        <div className="flex-1">
          <label className="field-label">Person</label>
          <select name="userId" className="input">
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.role})
              </option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="field-label">Access</label>
          <select name="memberRole" className="input">
            <option value="requester">requester</option>
            <option value="viewer">viewer</option>
            <option value="interviewer">interviewer</option>
          </select>
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Adding…">Add to opening</SubmitButton>
      </form>
    </div>
  );
}

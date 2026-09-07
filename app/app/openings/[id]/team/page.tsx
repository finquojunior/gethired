import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser, isStaff } from '@/lib/auth';
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
  const user = await currentUser();
  if (!(await canAccessOpening(user, openingId))) notFound();
  const staff = isStaff(user);

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
        Everyone added here can do everything in this opening: review candidates, move stages,
        book interviews, email, and edit the setup. Admins and HR have access to every opening
        without being added.{!staff && ' Only admins and HR can change who is on the team.'}
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
              {staff && (
              <form action={removeMember}>
                <input type="hidden" name="openingId" value={openingId} />
                <input type="hidden" name="userId" value={m.user_id} />
                <SubmitButton className="text-sm text-rust hover:underline" pendingLabel="…" doneMessage="Removed from opening">Remove</SubmitButton>
              </form>
              )}
            </div>
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-ink-soft">
            No one assigned yet. Add the requester and interviewers below.
          </li>
        )}
      </ul>

      {staff && (
      <form action={addMember} className="mt-6 flex flex-wrap items-end gap-2">
        <input type="hidden" name="openingId" value={openingId} />
        <div className="min-w-56 flex-1">
          <label className="field-label" htmlFor="member">Person</label>
          <select id="member" name="userId" className="input">
            {people
              .filter((p) => !members.some((m) => m.user_id === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.role})
                </option>
              ))}
          </select>
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Adding…" doneMessage="Added to opening">Add to opening</SubmitButton>
      </form>
      )}
      {staff && people.length === members.length && (
        <p className="mt-2 text-xs text-ink-soft">Everyone is already on this opening. Add new people from the Team page.</p>
      )}
    </div>
  );
}

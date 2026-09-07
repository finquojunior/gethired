import { q } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import SubmitButton from '@/components/SubmitButton';
import { addUser, removeUser, setUserRole } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team' };

const ROLES = ['admin', 'hr', 'dept_head', 'interviewer'];

export default async function TeamPage() {
  const me = await requireStaff();
  const admin = me.role === 'admin';
  const { rows: people } = await q<{
    id: string;
    full_name: string;
    role: string;
    email: string | null;
    openings: number;
  }>(
    `select p.id, p.full_name, p.role, u.email,
            (select count(*)::int from public.opening_members m where m.user_id = p.id) as openings
     from public.profiles p
     left join auth.users u on u.id = p.id
     order by p.full_name`
  );

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Team</h1>
      <p className="mt-4 text-sm text-ink-soft">
        Admins and HR see and manage everything. Department heads and interviewers only see the
        openings they&apos;ve been added to (each opening&apos;s Team tab), and can do everything
        inside those openings. People added here sign in with the password you set.
        {!admin && ' Only admins can add people or change roles.'}
      </p>

      <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-card">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <span className="font-medium">{p.full_name}</span>
              {p.id === me.id && <span className="ml-2 text-xs text-ink-soft">(you)</span>}
              <div className="text-sm text-ink-soft">
                {p.email ?? 'no email'} · on {p.openings} opening(s)
              </div>
            </div>
            {admin && (
            <div className="flex items-center gap-2">
              <form action={setUserRole} className="flex items-center gap-2">
                <input type="hidden" name="userId" value={p.id} />
                <select name="role" defaultValue={p.role} className="input w-36 py-1.5" disabled={p.id === me.id}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {p.id !== me.id && (
                  <SubmitButton className="btn-quiet" pendingLabel="Saving…" doneMessage="Role updated">Set role</SubmitButton>
                )}
              </form>
              {p.id !== me.id && (
                <form action={removeUser}>
                  <input type="hidden" name="userId" value={p.id} />
                  <SubmitButton
                    className="btn-danger !py-1 text-sm"
                    pendingLabel="Removing…"
                    doneMessage="Person removed"
                    confirmText={`Remove ${p.full_name}? Their login is deleted permanently and they are taken off ${p.openings} opening(s).`}
                  >
                    Remove
                  </SubmitButton>
                </form>
              )}
            </div>
            )}
          </li>
        ))}
      </ul>

      {admin && (
      <form action={addUser} className="mt-6 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="field-label" htmlFor="name">Name *</label>
          <input id="name" name="name" required className="input" />
        </div>
        <div className="min-w-56 flex-1">
          <label className="field-label" htmlFor="email">Email *</label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <div className="w-40">
          <label className="field-label" htmlFor="role">Role</label>
          <select id="role" name="role" className="input">
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="min-w-44">
          <label className="field-label" htmlFor="password">Password * (min 8 chars)</label>
          <input id="password" name="password" type="password" required minLength={8} className="input" />
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Adding…" doneMessage="Person added">Add person</SubmitButton>
      </form>
      )}
      {admin && (
        <p className="mt-2 text-xs text-ink-soft">
          If the email already exists, that person&apos;s name, role, and password are replaced.
        </p>
      )}
    </div>
  );
}

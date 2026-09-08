import Link from 'next/link';
import { q } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import SubmitButton from '@/components/SubmitButton';
import Flash from '@/components/Flash';
import {
  addDepartment,
  addUser,
  addUserOpening,
  deleteDepartment,
  removeUser,
  removeUserOpening,
  renameDepartment,
  setUserDepartments,
  setUserRole,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team' };

const ROLES: Array<[string, string]> = [
  ['admin', 'Admin — everything, plus people and settings'],
  ['hr', 'HR — every opening and department'],
  ['dept_head', 'Department head — assigned departments and openings'],
  ['interviewer', 'Interviewer — assigned departments and openings'],
];
const ROLE_LABEL: Record<string, string> = { admin: 'Admin', hr: 'HR', dept_head: 'Department head', interviewer: 'Interviewer' };

const OK: Record<string, string> = {
  added: 'Person added — they can sign in now',
  updated: 'Person updated',
  role: 'Role updated',
  removed: 'Person removed',
  departments: 'Departments saved',
  opening: 'Added to the opening',
  opening_removed: 'Removed from the opening',
  department_added: 'Department added',
  department_renamed: 'Department renamed everywhere',
  department_removed: 'Department removed — openings keep the label, people lose that access',
};
const ERR: Record<string, string> = {
  invalid: 'Check the fields — name, a valid email, and a role are required.',
  password: 'Password must be at least 8 characters.',
  duplicate: 'A department with that name already exists.',
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const { ok, e } = await searchParams;
  const me = await requireStaff();
  const admin = me.role === 'admin';

  const [{ rows: people }, { rows: departments }, { rows: openings }] = await Promise.all([
    q<{
      id: string;
      full_name: string;
      role: string;
      email: string | null;
      department_ids: number[];
      openings: Array<{ id: number; title: string; status: string }>;
    }>(
      `select p.id, p.full_name, p.role, u.email,
              coalesce((select array_agg(ud.department_id order by ud.department_id)
                        from public.user_departments ud where ud.user_id = p.id), '{}') as department_ids,
              coalesce((select json_agg(json_build_object('id', o.id, 'title', o.title, 'status', o.status) order by o.created_at desc)
                        from public.opening_members m join public.openings o on o.id = m.opening_id
                        where m.user_id = p.id), '[]') as openings
       from public.profiles p
       left join auth.users u on u.id = p.id
       order by case p.role when 'admin' then 0 when 'hr' then 1 else 2 end, p.full_name`
    ),
    q<{ id: number; name: string; openings: number; people: number }>(
      `select d.id, d.name,
              (select count(*)::int from public.openings o where o.department = d.name) as openings,
              (select count(*)::int from public.user_departments ud where ud.department_id = d.id) as people
       from public.departments d order by d.name`
    ),
    q<{ id: number; title: string; department: string; status: string }>(
      `select id, title, department, status from public.openings
       where status <> 'closed' order by department, created_at desc`
    ),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const scoped = (role: string) => role !== 'admin' && role !== 'hr';

  return (
    <div>
      <Flash kind={e ? 'error' : 'success'} message={e ? ERR[e] : ok ? OK[ok] : null} />
      <h1 className="track font-display text-3xl font-bold">Team</h1>
      <p className="mt-4 max-w-2xl text-sm text-ink-soft">
        Admins and HR see everything. Department heads and interviewers work only in what they are
        given here: a <strong>department</strong> grants every current and future opening in it and
        lets them create new openings there; an <strong>opening</strong> grants just that opening.
        Inside anything they can access they can do everything — pipeline, emails, interviews,
        setup, and team.{!admin && ' Only admins create accounts or change roles.'}
      </p>

      {/* ---------------- departments ---------------- */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Departments</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center gap-1 rounded-lg border border-line bg-card px-3 py-2 text-sm">
              <form action={renameDepartment} className="flex items-center gap-1">
                <input type="hidden" name="departmentId" value={d.id} />
                <input
                  name="name"
                  defaultValue={d.name}
                  aria-label={`Rename ${d.name}`}
                  className="w-36 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-line focus:border-line"
                />
                <SubmitButton className="btn-quiet !px-2 !py-0.5 text-xs" pendingLabel="…">Rename</SubmitButton>
              </form>
              <span className="text-xs text-ink-soft">
                {d.openings} opening{d.openings === 1 ? '' : 's'} · {d.people} {d.people === 1 ? 'person' : 'people'}
              </span>
              <form action={deleteDepartment}>
                <input type="hidden" name="departmentId" value={d.id} />
                <SubmitButton
                  className="btn-danger !px-2 !py-0.5 text-xs"
                  pendingLabel="…"
                  confirmText={`Remove the ${d.name} department from the list? Its ${d.openings} opening(s) keep the label; ${d.people} people lose access through it.`}
                >
                  Remove
                </SubmitButton>
              </form>
            </li>
          ))}
          {departments.length === 0 && <li className="text-sm text-ink-soft">No departments yet.</li>}
        </ul>
        <form action={addDepartment} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56">
            <label className="field-label" htmlFor="dept-name">New department</label>
            <input id="dept-name" name="name" required maxLength={80} placeholder="e.g. Marketing" className="input" />
          </div>
          <SubmitButton className="btn-quiet" pendingLabel="Adding…">Add department</SubmitButton>
        </form>
      </section>

      {/* ---------------- people ---------------- */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">People</h2>
        <ul className="mt-3 space-y-3">
          {people.map((p) => {
            const memberOf = new Set(p.openings.map((o) => o.id));
            const addable = openings.filter((o) => !memberOf.has(o.id));
            return (
              <li key={p.id} className="rounded-lg border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {p.full_name}
                      {p.id === me.id && <span className="ml-2 text-xs text-ink-soft">(you)</span>}
                    </div>
                    <div className="text-sm text-ink-soft">{p.email ?? 'no email'}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {admin && p.id !== me.id ? (
                      <form action={setUserRole} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={p.id} />
                        <select name="role" defaultValue={p.role} aria-label={`Role for ${p.full_name}`} className="input w-44 py-1.5">
                          {ROLES.map(([r, label]) => (
                            <option key={r} value={r}>{label.split(' — ')[0]}</option>
                          ))}
                        </select>
                        <SubmitButton className="btn-quiet !py-1.5" pendingLabel="Saving…">Set role</SubmitButton>
                      </form>
                    ) : (
                      <span className="rounded-full bg-pine-wash px-2.5 py-0.5 text-xs font-medium text-pine-deep">{ROLE_LABEL[p.role] ?? p.role}</span>
                    )}
                    {admin && p.id !== me.id && (
                      <form action={removeUser}>
                        <input type="hidden" name="userId" value={p.id} />
                        <SubmitButton
                          className="btn-danger !py-1.5 text-sm"
                          pendingLabel="Removing…"
                          confirmText={`Remove ${p.full_name}? Their login is deleted permanently.`}
                        >
                          Remove
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>

                {scoped(p.role) ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <form action={setUserDepartments} className="rounded-md border border-line p-3">
                      <input type="hidden" name="userId" value={p.id} />
                      <p className="field-label">Departments</p>
                      {departments.length === 0 && <p className="text-xs text-ink-soft">Add departments above first.</p>}
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {departments.map((d) => (
                          <label key={d.id} className="flex items-center gap-1.5">
                            <input type="checkbox" name="departmentIds" value={d.id} defaultChecked={p.department_ids.includes(d.id)} />
                            {d.name}
                          </label>
                        ))}
                      </div>
                      {departments.length > 0 && (
                        <SubmitButton className="btn-quiet mt-2 !py-1 text-xs" pendingLabel="Saving…">Save departments</SubmitButton>
                      )}
                    </form>

                    <div className="rounded-md border border-line p-3">
                      <p className="field-label">Openings (in addition to their departments)</p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {p.openings.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-2">
                            <Link href={`/app/openings/${o.id}`} className="text-pine underline">{o.title}</Link>
                            <form action={removeUserOpening}>
                              <input type="hidden" name="userId" value={p.id} />
                              <input type="hidden" name="openingId" value={o.id} />
                              <SubmitButton className="text-xs text-rust hover:underline" pendingLabel="…">remove</SubmitButton>
                            </form>
                          </li>
                        ))}
                        {p.openings.length === 0 && <li className="text-xs text-ink-soft">None assigned directly.</li>}
                      </ul>
                      {addable.length > 0 && (
                        <form action={addUserOpening} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="userId" value={p.id} />
                          <select name="openingId" aria-label={`Add ${p.full_name} to an opening`} className="input flex-1 py-1 text-sm">
                            {addable.map((o) => (
                              <option key={o.id} value={o.id}>{o.title}{o.department ? ` · ${o.department}` : ''}</option>
                            ))}
                          </select>
                          <SubmitButton className="btn-quiet !py-1 text-xs" pendingLabel="Adding…">Add</SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-soft">Has access to every opening and department.</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------------- add person ---------------- */}
      {admin && (
        <section className="mt-10 rounded-lg border border-line bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Add a person</h2>
          <p className="mt-1 text-xs text-ink-soft">
            One step: account, role, and what they can work on. If the email already exists, that
            person&apos;s name, role, and password are replaced and the assignments are added.
          </p>
          <form action={addUser} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="name">Name *</label>
                <input id="name" name="name" required className="input" />
              </div>
              <div>
                <label className="field-label" htmlFor="email">Email *</label>
                <input id="email" name="email" type="email" required className="input" />
              </div>
              <div>
                <label className="field-label" htmlFor="role">Role *</label>
                <select id="role" name="role" className="input" defaultValue="dept_head">
                  {ROLES.map(([r, label]) => (
                    <option key={r} value={r}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="password">Password * (min 8 characters)</label>
                <input id="password" name="password" type="password" required minLength={8} className="input" />
              </div>
            </div>
            <fieldset className="rounded-md border border-line p-3">
              <legend className="field-label px-1">Departments (department heads and interviewers only)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="departmentIds" value={d.id} />
                    {d.name}
                  </label>
                ))}
                {departments.length === 0 && <span className="text-xs text-ink-soft">No departments yet.</span>}
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-line p-3">
              <legend className="field-label px-1">Specific openings (optional)</legend>
              <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {openings.map((o) => (
                  <label key={o.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="openingIds" value={o.id} />
                    {o.title}{o.department ? <span className="text-ink-soft"> · {o.department}</span> : null}
                  </label>
                ))}
                {openings.length === 0 && <span className="text-xs text-ink-soft">No active openings.</span>}
              </div>
            </fieldset>
            <SubmitButton className="btn-primary" pendingLabel="Adding…">Add person</SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}

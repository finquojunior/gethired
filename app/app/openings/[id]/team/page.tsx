import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import SubmitButton from '@/components/SubmitButton';
import OpeningTabs from '@/components/OpeningTabs';
import { addMember, removeMember } from '../../actions';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Team` : 'Team' };
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();
  const user = await currentUser();
  if (!(await canAccessOpening(user, openingId))) notFound();
  const staff = true; // anyone who can work in the opening may manage its team

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
        <Link href={`/app/openings/${openingId}`} className="text-muted-foreground hover:underline">
          {opening.title}
        </Link>{' '}
        · Team
      </h1>
      <OpeningTabs openingId={openingId} current="team" />
      <p className="mt-4 text-sm text-muted-foreground">
        Everyone added here can do everything in this opening: review candidates, move stages,
        book interviews, email, and edit the setup. Admins and HR have access to every opening
        without being added, and department members have access to every opening in their departments.
      </p>

      <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-card">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between px-5 py-3">
            <div>
              <span className="font-medium">{m.full_name}</span>
              <span className="ml-2 text-sm text-muted-foreground">{m.role}</span>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{m.member_role}</Badge>
              {staff && (
              <form action={removeMember}>
                <input type="hidden" name="openingId" value={openingId} />
                <input type="hidden" name="userId" value={m.user_id} />
                <SubmitButton variant="destructive" size="sm" pendingLabel="Removing…" doneMessage="Removed from opening" confirmText={`Remove ${m.full_name} from this opening? They lose access to its candidates unless they hold an interview slot.`}>Remove</SubmitButton>
              </form>
              )}
            </div>
          </li>
        ))}
        {members.length === 0 && (
          <li>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No one assigned yet.</EmptyTitle>
                <EmptyDescription>Add the requester and interviewers below.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </li>
        )}
      </ul>

      {staff && (
      <form action={addMember} className="mt-6 flex flex-wrap items-end gap-2">
        <input type="hidden" name="openingId" value={openingId} />
        <Field className="min-w-56 flex-1">
          <Label htmlFor="member">Person *</Label>
          <NativeSelect className="w-full" id="member" name="userId">
            {people
              .filter((p) => !members.some((m) => m.user_id === p.id))
              .map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.full_name} ({p.role})
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </Field>
        <SubmitButton pendingLabel="Adding…" doneMessage="Added to opening">Add to opening</SubmitButton>
      </form>
      )}
      {staff && people.length === members.length && (
        <p className="mt-2 text-xs text-muted-foreground">Everyone is already on this opening. Add new people from the Team page.</p>
      )}
    </div>
  );
}

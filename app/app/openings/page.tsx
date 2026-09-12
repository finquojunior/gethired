import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, departmentScope, isStaff, openingScope, scopeSql } from '@/lib/auth';
import Flash from '@/components/Flash';
import SubmitButton from '@/components/SubmitButton';
import { createOpening } from './actions';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

const STATUS_BADGE: Record<string, { variant: 'outline' | 'secondary' | 'destructive'; className?: string }> = {
  draft: { variant: 'outline' },
  open: { variant: 'secondary' },
  paused: { variant: 'outline', className: 'border-transparent bg-amber/15 text-amber' },
  closed: { variant: 'destructive' },
};

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Openings' };

export default async function OpeningsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; e?: string; ok?: string }>;
}) {
  const { show, e, ok } = await searchParams;
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
        <div className="mb-1 inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1 text-sm">
          {[
            ['Active', '/app/openings', !closed],
            ['Closed', '/app/openings?show=closed', closed],
          ].map(([label, href, active]) => (
            <Link
              key={String(label)}
              href={String(href)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-7 items-center rounded-md px-3 transition-colors',
                active ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {e && ERR[e] && <Flash kind="error" message={ERR[e]} cleanParams={['e']} />}
      {ok === 'deleted' && <Flash kind="success" message="Opening deleted — its candidates, files and emails are gone" cleanParams={['ok']} />}
      {canCreate && (
      <form action={createOpening} className="mt-8 flex flex-wrap items-end gap-3">
        <Field className="min-w-56 flex-1">
          <Label htmlFor="title">New opening *</Label>
          <Input id="title" name="title" required placeholder="e.g. Performance Marketer" />
        </Field>
        <Field className="w-52">
          <Label htmlFor="department">Department{isStaff(user) ? '' : ' *'}</Label>
          <NativeSelect className="w-full" id="department" name="department" required={!isStaff(user)} defaultValue={creatable.length === 1 ? creatable[0] : ''}>
            {isStaff(user) && <NativeSelectOption value="">— none —</NativeSelectOption>}
            {creatable.map((d) => (
              <NativeSelectOption key={d} value={d}>{d}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <SubmitButton pendingLabel="Creating…">Create opening</SubmitButton>
        {isStaff(user) && departments.length === 0 && (
          <p className="w-full text-xs text-muted-foreground">No departments yet — add them on the <Link href="/app/team" className="text-primary underline">Team</Link> page.</p>
        )}
      </form>
      )}

      <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-card">
        {openings.map((o) => (
          <li key={o.id}>
            <Link
              href={`/app/openings/${o.id}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 hover:bg-muted/40 sm:px-5"
            >
              <div>
                <div className="font-medium">{o.title}</div>
                <div className="text-sm text-muted-foreground">{o.department || '—'}</div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">{o.applications} candidate{o.applications === '1' ? '' : 's'}</span>
                <Badge variant={STATUS_BADGE[o.status]?.variant ?? 'outline'} className={STATUS_BADGE[o.status]?.className}>
                  {o.status}
                </Badge>
              </div>
            </Link>
          </li>
        ))}
        {openings.length === 0 && (
          <li>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No openings yet.</EmptyTitle>
                <EmptyDescription>Create the first one above.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </li>
        )}
      </ul>
    </div>
  );
}

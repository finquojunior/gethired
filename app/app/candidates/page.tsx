import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, openingScope, scopeSql } from '@/lib/auth';
import { fmtDate } from '@/lib/tz';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import LiveSearch from '@/components/LiveSearch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Candidates' };

const LIMIT = 50;

export default async function CandidatesSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: query = '' } = await searchParams;
  const term = query.trim().slice(0, 100);

  const tagSearch = term.startsWith('tag:') ? term.slice(4).trim() : null;
  const scope = await openingScope(await currentUser());
  const { rows: results } = term
    ? await q<{
        id: number;
        name: string;
        email: string;
        status: string;
        title: string;
        stage: string | null;
        tags: string[];
        created_at: Date;
      }>(
        `select a.id, a.name, a.email, a.status, o.title, s.name as stage, a.tags, a.created_at
         from public.applications a
         join public.openings o on o.id = a.opening_id
         left join public.stages s on s.id = a.current_stage_id
         where ${scopeSql('o.id', 3)} and (($2::text is not null and $2 = any(a.tags))
            or ($2::text is null and (a.name ilike $1 or a.email ilike $1)))
         order by a.created_at desc limit ${LIMIT + 1}`,
        [`%${term}%`, tagSearch, scope]
      )
    : { rows: [] };
  const truncated = results.length > LIMIT;
  if (truncated) results.pop();

  const { rows: openings } = term
    ? { rows: [] }
    : await q<{ id: number; title: string; department: string; status: string; active: number; total: number }>(
        `select o.id, o.title, o.department, o.status,
                count(a.id) filter (where a.status = 'active')::int as active,
                count(a.id)::int as total
         from public.openings o
         left join public.applications a on a.opening_id = o.id
         where ${scopeSql('o.id', 1)}
         group by o.id
         having count(a.id) > 0
         order by o.status = 'open' desc, o.created_at desc`,
        [scope]
      );

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Candidates</h1>
      <form method="get" className="mt-8 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="q">Search candidates</label>
        <LiveSearch
          id="q"
          name="q"
          defaultValue={term}
          placeholder="Search by name or email — or tag:frontend to search tags…" className="min-w-48 flex-1"
          autoFocus />
      </form>

      {!term && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">Browse by opening</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick an opening to see its candidates — then filter by stage, status, date, and sort
            inside.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {openings.map((o) => (
              <Link key={o.id} href={`/app/openings/${o.id}/applications`} className="rounded-xl">
                <Card size="sm" className="h-full transition-shadow hover:ring-primary/50">
                  <CardContent>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{o.title}</span>
                      <Badge variant="secondary" className="shrink-0">{o.active} active</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {[o.department, `${o.total} total`, o.status].filter(Boolean).join(' · ')}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {openings.length === 0 && (
              <Empty className="sm:col-span-2">
                <EmptyHeader>
                  <EmptyTitle>No candidates anywhere yet.</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </section>
      )}

      {term && (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-card">
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/app/candidates/${r.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/40"
              >
                <div>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">{r.email}</span>
                  {r.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="ml-1.5">{t}</Badge>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">
                  {r.title} · {r.stage ?? '—'} · {r.status} · {fmtDate(r.created_at)}
                </div>
              </Link>
            </li>
          ))}
          {results.length === 0 && (
            <li>
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No candidates match “{term}”.</EmptyTitle>
                  <EmptyDescription>Try a different name, email, or tag.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </li>
          )}
          {truncated && (
            <li className="px-5 py-3 text-center text-xs text-muted-foreground">
              Showing the first {LIMIT} matches — refine your search.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDate } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export default async function CandidatesSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: query = '' } = await searchParams;
  const term = query.trim().slice(0, 100);

  const tagSearch = term.startsWith('tag:') ? term.slice(4).trim() : null;
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
         where ($2::text is not null and $2 = any(a.tags))
            or ($2::text is null and (a.name ilike $1 or a.email ilike $1))
         order by a.created_at desc limit 50`,
        [`%${term}%`, tagSearch]
      )
    : { rows: [] };

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Candidates</h1>
      <form method="get" className="mt-8 flex gap-2">
        <input
          name="q"
          defaultValue={term}
          placeholder="Search by name or email — or tag:frontend to search tags…"
          className="input flex-1"
          autoFocus
        />
        <button className="btn-primary">Search</button>
      </form>

      {term && (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-card">
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/app/candidates/${r.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-paper"
              >
                <div>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-sm text-ink-soft">{r.email}</span>
                  {r.tags.map((t) => (
                    <span key={t} className="ml-1.5 rounded-full bg-pine-wash px-2 py-0.5 text-xs text-pine-deep">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-ink-soft">
                  {r.title} · {r.stage ?? '—'} · {r.status} · {fmtDate(r.created_at)}
                </div>
              </Link>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-ink-soft">
              No candidates match “{term}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

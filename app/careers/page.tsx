import Link from 'next/link';
import type { Metadata } from 'next';
import { q } from '@/lib/db';

export const revalidate = 60; // ad-burst traffic hits cache, not Postgres

const ORG = process.env.ORG_NAME ?? 'ThinkForge';

export const metadata: Metadata = {
  title: `Careers at ${ORG}`,
  description: `Open roles at ${ORG} — apply in minutes, track your application online.`,
  openGraph: {
    title: `Careers at ${ORG}`,
    description: `Open roles at ${ORG}`,
    type: 'website',
  },
};

export default async function CareersPage() {
  const { rows: openings } = await q<{
    slug: string;
    title: string;
    department: string;
    location: string;
    employment_type: string;
    poster_path: string;
  }>(
    `select o.slug, o.title, o.department, o.location, o.employment_type, o.poster_path
     from public.openings o
     where o.status = 'open'
       and (o.close_at is null or o.close_at > now())
       and exists (select 1 from public.forms f where f.opening_id = o.id and f.is_published)
     order by o.created_at desc`
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-pine">{ORG} · We&apos;re hiring</p>
      <h1 className="track mt-2 font-display text-4xl font-bold">Open roles</h1>
      <p className="mt-4 text-ink-soft">
        Join the team. Apply in minutes — you&apos;ll get a private link to track your application,
        book interviews, and hear back at every step.
      </p>
      <ul className="mt-10 space-y-3">
        {openings.map((o) => (
          <li key={o.slug}>
            <Link
              href={`/careers/${o.slug}`}
              className="flex items-center gap-4 rounded-lg border border-line bg-card px-4 py-4 hover:border-pine sm:px-5"
            >
              {o.poster_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/files/${o.poster_path}`}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-semibold">{o.title}</div>
                <div className="truncate text-sm text-ink-soft">
                  {[o.department, o.location, o.employment_type].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="shrink-0 text-pine">Apply →</span>
            </Link>
          </li>
        ))}
        {openings.length === 0 && (
          <li className="rounded-lg border border-line bg-card px-5 py-10 text-center text-ink-soft">
            No open roles right now — check back soon.
          </li>
        )}
      </ul>
    </main>
  );
}

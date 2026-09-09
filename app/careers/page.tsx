import Link from 'next/link';
import type { Metadata } from 'next';
import { q } from '@/lib/db';
import { ORG_NAME as ORG } from '@/lib/email';
import CandidateFooter from '@/components/CandidateFooter';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription } from '@/components/ui/empty';

export const revalidate = 60; // ad-burst traffic hits cache, not Postgres

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
      <p className="text-sm font-medium uppercase tracking-widest text-primary">{ORG} · We&apos;re hiring</p>
      <h1 className="track mt-2 font-display text-4xl font-bold">Open roles</h1>
      <p className="mt-4 text-muted-foreground">
        Join the team. Apply in minutes — you&apos;ll get a private link to track your application,
        book interviews, and hear back at every step.
      </p>
      <ul className="mt-10 space-y-3">
        {openings.map((o) => (
          <li key={o.slug}>
            <Card>
              <CardHeader className="items-center">
                <div className="flex items-center gap-4">
                  {o.poster_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${o.poster_path}`}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg border border-border object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <CardTitle className="font-display text-lg font-semibold">{o.title}</CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {[o.department, o.location].filter(Boolean).join(' · ')}
                      {o.employment_type && <Badge variant="secondary">{o.employment_type}</Badge>}
                    </CardDescription>
                  </div>
                </div>
                <CardAction className="self-center">
                  <Link href={`/careers/${o.slug}`} className={buttonVariants({ size: 'lg' })}>
                    Apply →
                  </Link>
                </CardAction>
              </CardHeader>
            </Card>
          </li>
        ))}
        {openings.length === 0 && (
          <li>
            <Empty className="bg-card ring-1 ring-foreground/10">
              <EmptyDescription>No open roles right now — check back soon.</EmptyDescription>
            </Empty>
          </li>
        )}
      </ul>
      <CandidateFooter />
    </main>
  );
}

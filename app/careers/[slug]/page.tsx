import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { renderRich } from '@/lib/richtext';
import type { FormSchema } from '@/lib/form-schema';
import { directUploads } from '@/lib/storage';
import { ORG_NAME as ORG } from '@/lib/email';
import CandidateFooter from '@/components/CandidateFooter';
import CandidateResendForm from '@/components/CandidateResendForm';
import ApplyForm from './ApplyForm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const revalidate = 60; // ad-burst traffic hits cache, not Postgres

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const {
    rows: [o],
  } = await q<{ title: string; location: string }>(
    `select title, location from public.openings where slug = $1`,
    [slug]
  );
  if (!o) return { title: `Careers at ${ORG}` };
  return {
    title: `${o.title} · ${ORG}`,
    description: `Apply for ${o.title}${o.location ? ` (${o.location})` : ''} at ${ORG}.`,
    openGraph: { title: `${o.title} · ${ORG}`, type: 'website' },
  };
}

export default async function OpeningPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const {
    rows: [o],
  } = await q<{
    title: string;
    department: string;
    description: string;
    location: string;
    employment_type: string;
    salary_range: string;
    notes: string;
    consent_text: string;
    poster_path: string;
    form_id: number | null;
    schema: FormSchema | null;
    accepting: boolean;
  }>(
    // no status filter: a closed/paused role renders a "no longer accepting"
    // page (with a way back) instead of a bare 404
    `select o.title, o.department, o.description, o.location, o.employment_type,
            o.salary_range, o.notes, o.consent_text, o.poster_path, f.id as form_id, f.schema,
            (o.status = 'open' and (o.close_at is null or o.close_at > now()) and f.id is not null) as accepting
     from public.openings o
     left join public.forms f on f.opening_id = o.id and f.is_published
     where o.slug = $1
     order by f.id desc nulls last limit 1`,
    [slug]
  );
  if (!o) notFound();
  if (!o.accepting || !o.form_id || !o.schema) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">{ORG}</p>
        <h1 className="track mt-2 font-display text-3xl font-bold">{o.title}</h1>
        <Alert className="mt-6">
          <AlertTitle>This role is no longer accepting applications.</AlertTitle>
          <AlertDescription>
            If you already applied, your status link from the confirmation email still works.
          </AlertDescription>
        </Alert>
        <Link href="/careers" className={`${buttonVariants({ size: 'lg' })} mt-6`}>See other open roles →</Link>
        <CandidateFooter />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/careers" className="text-sm text-muted-foreground hover:text-primary">
        ← All open roles
      </Link>
      {o.department && (
        <p className="mt-4 text-sm font-medium uppercase tracking-widest text-primary">{o.department}</p>
      )}
      <h1 className="track mt-2 font-display text-4xl font-bold">{o.title}</h1>
      {o.poster_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${o.poster_path}`}
          alt={`${o.title} — role poster`}
          className="mt-6 max-h-96 w-full rounded-xl border border-border object-contain"
        />
      )}
      {(o.location || o.employment_type || o.salary_range) && (
        <p className="mt-4 text-sm font-medium text-muted-foreground">
          {[o.location, o.employment_type, o.salary_range].filter(Boolean).join(' · ')}
        </p>
      )}
      {o.description && (
        <div
          className="mt-6 max-w-prose space-y-2 text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: renderRich(o.description) }}
        />
      )}
      {o.notes && (
        <Alert className="mt-6 border-amber/40 bg-amber/15">
          <AlertTitle className="text-amber">Before you apply</AlertTitle>
          <AlertDescription
            className="space-y-1 text-foreground"
            dangerouslySetInnerHTML={{ __html: renderRich(o.notes) }}
          />
        </Alert>
      )}
      <Card className="mt-10 sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="font-display text-xl font-semibold">
            <h2>Apply for {o.title}</h2>
          </CardTitle>
          <CardDescription>
            Takes only a few minutes. Fields marked <span className="text-destructive">*</span> are
            required — you&apos;ll get a private link by email to track your application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApplyForm direct={directUploads} slug={slug} formId={o.form_id} schema={o.schema} consentText={o.consent_text} />
        </CardContent>
      </Card>
      <CandidateResendForm slug={slug} />
      <CandidateFooter />
    </main>
  );
}

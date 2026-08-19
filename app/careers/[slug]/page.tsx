import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import type { FormSchema } from '@/lib/form-schema';
import ApplyForm from './ApplyForm';

export const revalidate = 60; // ad-burst traffic hits cache, not Postgres

const ORG = process.env.ORG_NAME ?? 'Finquo Junior';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const {
    rows: [o],
  } = await q<{ title: string; location: string }>(
    `select title, location from public.openings where slug = $1 and status = 'open'`,
    [slug]
  );
  if (!o) return { title: `Careers at ${ORG}` };
  return {
    title: `${o.title} — ${ORG}`,
    description: `Apply for ${o.title}${o.location ? ` (${o.location})` : ''} at ${ORG}.`,
    openGraph: { title: `${o.title} — ${ORG}`, type: 'website' },
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
    form_id: number;
    schema: FormSchema;
  }>(
    `select o.title, o.department, o.description, o.location, o.employment_type,
            o.salary_range, o.notes, o.consent_text, o.poster_path, f.id as form_id, f.schema
     from public.openings o
     join public.forms f on f.opening_id = o.id and f.is_published
     where o.slug = $1 and o.status = 'open'
       and (o.close_at is null or o.close_at > now())`,
    [slug]
  );
  if (!o) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/careers" className="text-sm text-ink-soft hover:text-pine">
        ← All open roles
      </Link>
      {o.poster_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${o.poster_path}`}
          alt={`${o.title} — role poster`}
          className="mt-4 w-full rounded-xl border border-line"
        />
      )}
      {o.department && (
        <p className="text-sm font-medium uppercase tracking-widest text-pine">{o.department}</p>
      )}
      <h1 className="track mt-2 font-display text-4xl font-bold">{o.title}</h1>
      {(o.location || o.employment_type || o.salary_range) && (
        <p className="mt-4 text-sm font-medium text-ink-soft">
          {[o.location, o.employment_type, o.salary_range].filter(Boolean).join(' · ')}
        </p>
      )}
      {o.description && (
        <p className="mt-6 whitespace-pre-line text-ink-soft">{o.description}</p>
      )}
      {o.notes && (
        <div className="mt-6 rounded-lg border border-amber/40 bg-amber/10 p-4">
          <p className="text-sm font-semibold text-amber">Before you apply</p>
          <p className="mt-1 whitespace-pre-line text-sm">{o.notes}</p>
        </div>
      )}
      <div className="mt-10 rounded-lg border border-line bg-card p-4 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Apply for {o.title}</h2>
        <p className="mb-5 mt-1 text-sm text-ink-soft">
          Takes only a few minutes. Fields marked <span className="text-rust">*</span> are
          required — you&apos;ll get a private link by email to track your application.
        </p>
        <ApplyForm slug={slug} formId={o.form_id} schema={o.schema} consentText={o.consent_text} />
      </div>
    </main>
  );
}

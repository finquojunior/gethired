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
        <p className="text-sm font-medium uppercase tracking-widest text-pine">{ORG}</p>
        <h1 className="track mt-2 font-display text-3xl font-bold">{o.title}</h1>
        <p className="mt-6 text-lg">This role is no longer accepting applications.</p>
        <p className="mt-2 text-sm text-ink-soft">
          If you already applied, your status link from the confirmation email still works.
        </p>
        <Link href="/careers" className="btn-primary mt-6 min-h-11">See other open roles →</Link>
        <CandidateFooter />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/careers" className="text-sm text-ink-soft hover:text-pine">
        ← All open roles
      </Link>
      {o.department && (
        <p className="mt-4 text-sm font-medium uppercase tracking-widest text-pine">{o.department}</p>
      )}
      <h1 className="track mt-2 font-display text-4xl font-bold">{o.title}</h1>
      {o.poster_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${o.poster_path}`}
          alt={`${o.title} — role poster`}
          className="mt-6 max-h-96 w-full rounded-xl border border-line object-contain"
        />
      )}
      {(o.location || o.employment_type || o.salary_range) && (
        <p className="mt-4 text-sm font-medium text-ink-soft">
          {[o.location, o.employment_type, o.salary_range].filter(Boolean).join(' · ')}
        </p>
      )}
      {o.description && (
        <div
          className="mt-6 space-y-2 text-ink-soft"
          dangerouslySetInnerHTML={{ __html: renderRich(o.description) }}
        />
      )}
      {o.notes && (
        <div className="mt-6 rounded-lg border border-amber/40 bg-amber/10 p-4">
          <p className="text-sm font-semibold text-amber">Before you apply</p>
          <div
            className="mt-1 space-y-1 text-sm"
            dangerouslySetInnerHTML={{ __html: renderRich(o.notes) }}
          />
        </div>
      )}
      <div className="mt-10 rounded-lg border border-line bg-card p-4 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Apply for {o.title}</h2>
        <p className="mb-5 mt-1 text-sm text-ink-soft">
          Takes only a few minutes. Fields marked <span className="text-rust">*</span> are
          required — you&apos;ll get a private link by email to track your application.
        </p>
        <ApplyForm direct={directUploads} slug={slug} formId={o.form_id} schema={o.schema} consentText={o.consent_text} />
      </div>
      <CandidateResendForm slug={slug} />
      <CandidateFooter />
    </main>
  );
}

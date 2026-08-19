import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import SubmitButton from '@/components/SubmitButton';
import RichTextArea from '@/components/RichTextArea';
import { POSTER_ACCEPT } from '@/lib/uploads';
import { updateOpening } from '../actions';

export const dynamic = 'force-dynamic';

export default async function OpeningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { id } = await params;
  const { e } = await searchParams;
  const {
    rows: [o],
  } = await q<{
    id: number;
    slug: string;
    title: string;
    department: string;
    description: string;
    status: string;
    location: string;
    employment_type: string;
    salary_range: string;
    close_at: Date | null;
    notes: string;
    consent_text: string;
    poster_path: string;
    published_version: number | null;
    applications: string;
  }>(
    `select o.*,
            (select version from public.forms f where f.opening_id = o.id and f.is_published) as published_version,
            (select count(*) from public.applications a where a.opening_id = o.id) as applications
     from public.openings o where o.id = $1`,
    [Number(id)]
  );
  if (!o) notFound();

  return (
    <div>
      <BackButton fallback="/app/openings" />
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{o.title}</h1>
        <div className="flex flex-wrap gap-2 pb-1">
          <Link href={`/app/openings/${o.id}/form`} className="btn-quiet">
            Form{o.published_version ? ` · v${o.published_version}` : ' · unpublished'}
          </Link>
          <Link href={`/app/openings/${o.id}/stages`} className="btn-quiet">Stages</Link>
          <Link href={`/app/openings/${o.id}/team`} className="btn-quiet">Team</Link>
          <Link href={`/app/openings/${o.id}/slots`} className="btn-quiet">Slots</Link>
          <Link href={`/app/openings/${o.id}/applications`} className="btn-quiet">
            Applications ({o.applications})
          </Link>
        </div>
      </div>

      {o.status === 'open' && (
        <p className="mt-4 text-sm text-ink-soft">
          Public link:{' '}
          <Link href={`/careers/${o.slug}`} className="font-medium text-pine underline">
            /careers/{o.slug}
          </Link>{' '}
          — use this in your Meta ads.
        </p>
      )}

      {e === 'slug' && (
        <p className="mt-4 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">
          That public link is empty or already used by another opening — pick a different one.
        </p>
      )}

      <form action={updateOpening} className="mt-8 max-w-2xl space-y-4">
        <input type="hidden" name="id" value={o.id} />
        <div>
          <label className="field-label" htmlFor="title">Title</label>
          <input id="title" name="title" defaultValue={o.title} required className="input" />
        </div>
        <div>
          <label className="field-label" htmlFor="slug">
            Public link — /careers/…
          </label>
          <input id="slug" name="slug" defaultValue={o.slug} required className="input font-mono text-sm" />
          <p className="mt-1 text-xs text-ink-soft">
            The link doesn&apos;t change automatically when the title changes. Careful editing it
            after sharing — links already posted in ads keep pointing at the old address.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="field-label" htmlFor="department">Department</label>
            <input id="department" name="department" defaultValue={o.department} className="input" />
          </div>
          <div className="w-44">
            <label className="field-label" htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={o.status} className="input">
              <option value="draft">draft</option>
              <option value="open">open</option>
              <option value="paused">paused</option>
              <option value="closed">closed</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="field-label" htmlFor="location">Location</label>
            <input id="location" name="location" defaultValue={o.location} placeholder="e.g. Kochi / Remote" className="input" />
          </div>
          <div className="flex-1">
            <label className="field-label" htmlFor="employment_type">Employment type</label>
            <input id="employment_type" name="employment_type" defaultValue={o.employment_type} placeholder="Full-time" className="input" />
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="field-label" htmlFor="salary_range">Salary range (shown publicly if set)</label>
            <input id="salary_range" name="salary_range" defaultValue={o.salary_range} placeholder="e.g. ₹4–6 LPA" className="input" />
          </div>
          <div className="w-44">
            <label className="field-label" htmlFor="close_date">Auto-close on</label>
            <input
              id="close_date"
              type="date"
              name="close_date"
              defaultValue={o.close_at ? o.close_at.toISOString().slice(0, 10) : ''}
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="description">Description (shown on the public page)</label>
          <RichTextArea id="description" name="description" rows={6} defaultValue={o.description} />
        </div>
        <div>
          <label className="field-label" htmlFor="notes">
            Important notes (highlighted to candidates before they apply)
          </label>
          <RichTextArea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={o.notes}
            placeholder={'e.g. Work from office (Kochi). Immediate joiners preferred.\nShortlisted candidates get a task round.'}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="consent_text">
            Consent text (candidates must tick this to apply — leave empty for the standard line)
          </label>
          <input
            id="consent_text"
            name="consent_text"
            defaultValue={o.consent_text}
            placeholder="I agree that my details and resume are stored and used for this recruitment process."
            className="input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="poster">
            Role poster (shown on the public page — JPG/PNG/WebP, up to 3 MB)
          </label>
          {e === 'poster' && (
            <p className="mb-2 rounded-md bg-rust/10 px-3 py-2 text-sm text-rust">
              Poster must be a JPG, PNG, or WebP up to 3 MB.
            </p>
          )}
          {o.poster_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${o.poster_path}`}
              alt="Current role poster"
              className="mb-2 max-h-48 rounded-lg border border-line"
            />
          )}
          <input id="poster" type="file" name="poster" accept={POSTER_ACCEPT} className="input" />
          {o.poster_path && (
            <label className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
              <input type="checkbox" name="removePoster" value="1" className="accent-pine" />
              remove current poster
            </label>
          )}
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Saving…">Save changes</SubmitButton>
      </form>
    </div>
  );
}

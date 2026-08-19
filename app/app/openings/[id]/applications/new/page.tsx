import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import SubmitButton from '@/components/SubmitButton';
import { RESUME_ACCEPT } from '@/lib/uploads';
import { addCandidate, importCsv } from '@/app/app/candidates/actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a name and a valid email.',
  resume: 'Resume must be PDF or Word, up to 5 MB.',
  duplicate: 'A candidate with this email already exists for this opening.',
  csv: 'CSV must be under 2 MB with at least name and email columns.',
};

export default async function AddCandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { id } = await params;
  const { e } = await searchParams;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();
  const { rows: stages } = await q<{ id: number; name: string }>(
    'select id, name from public.stages where opening_id = $1 order by position',
    [openingId]
  );

  return (
    <div className="max-w-xl">
      <BackButton fallback={`/app/openings/${openingId}/applications`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}/applications`} className="text-ink-soft hover:underline">
          {opening.title}
        </Link>{' '}
        · Add candidate
      </h1>
      <p className="mt-4 text-sm text-ink-soft">
        For candidates who reached you outside the form — walk-ins, referrals, WhatsApp resumes.
        No email is sent to them.
      </p>

      {e && ERRORS[e] && (
        <p className="mt-4 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">{ERRORS[e]}</p>
      )}

      <form action={addCandidate} className="mt-6 space-y-4">
        <input type="hidden" name="openingId" value={openingId} />
        <div>
          <label className="field-label" htmlFor="name">Full name *</label>
          <input id="name" name="name" required className="input" />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="field-label" htmlFor="email">Email *</label>
            <input id="email" name="email" type="email" required className="input" />
          </div>
          <div className="flex-1">
            <label className="field-label" htmlFor="phone">Phone</label>
            <input id="phone" name="phone" className="input" />
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="field-label" htmlFor="resume">Resume (optional)</label>
            <input id="resume" name="resume" type="file" accept={RESUME_ACCEPT} className="input" />
          </div>
          <div className="w-48">
            <label className="field-label" htmlFor="stageId">Start in stage</label>
            <select id="stageId" name="stageId" className="input">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="note">Internal note</label>
          <textarea id="note" name="note" rows={2} placeholder="e.g. Sent resume on WhatsApp, referred by…" className="input" />
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Adding…">Add candidate</SubmitButton>
      </form>

      <details className="mt-10 rounded-lg border border-line bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">Bulk import from CSV (your old Excel)</summary>
        <p className="mt-2 text-ink-soft">
          Save your sheet as CSV with a header row: <code>name,email,phone,status,notes</code>.
          Status can be active, hired, rejected, or withdrawn (defaults to active). Duplicate
          emails are skipped. Imported candidates are tagged with source “import”.
        </p>
        <form action={importCsv} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="openingId" value={openingId} />
          <input type="file" name="file" accept=".csv" required className="input flex-1" />
          <SubmitButton className="btn-primary" pendingLabel="Importing…">Import</SubmitButton>
        </form>
      </details>
    </div>
  );
}

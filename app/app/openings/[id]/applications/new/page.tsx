import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser } from '@/lib/auth';
import SubmitButton from '@/components/SubmitButton';
import { AlertTriangle } from 'lucide-react';
import DirectUploadForm from '@/components/DirectUploadForm';
import { RESUME_ACCEPT, RESUME_MAX_BYTES } from '@/lib/uploads';
import { directUploads } from '@/lib/storage';
import { addCandidate, importCsv } from '@/app/app/candidates/actions';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field } from '@/components/ui/field';
import { Alert, AlertTitle } from '@/components/ui/alert';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Add candidate` : 'Add candidate' };
}

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
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();
  const { rows: stages } = await q<{ id: number; name: string }>(
    'select id, name from public.stages where opening_id = $1 order by position',
    [openingId]
  );

  return (
    <div className="max-w-xl">
      <BackButton fallback={`/app/openings/${openingId}/applications`} />
      <h1 className="track font-display text-3xl font-bold">
        <Link href={`/app/openings/${openingId}/applications`} className="text-muted-foreground hover:underline">
          {opening.title}
        </Link>{' '}
        · Add candidate
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        For candidates who reached you outside the form — walk-ins, referrals, WhatsApp resumes.
        No email is sent to them.
      </p>

      {e && ERRORS[e] && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle />
          <AlertTitle>{ERRORS[e]}</AlertTitle>
        </Alert>
      )}

      <DirectUploadForm
        direct={directUploads}
        signUrl={`/app/openings/${openingId}/applications/new/upload-url`}
        fileField="resume"
        maxBytes={RESUME_MAX_BYTES}
        action={addCandidate}
        encType="multipart/form-data"
        className="mt-6 space-y-4"
      >
        <input type="hidden" name="openingId" value={openingId} />
        <input type="hidden" name="resumePath" defaultValue="" />
        <input type="hidden" name="resumeSig" defaultValue="" />
        <Field className="w-full">
          <Label htmlFor="name">Full name *</Label>
          <Input id="name" name="name" required />
        </Field>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field className="flex-1">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" name="email" type="email" required />
          </Field>
          <Field className="flex-1">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </Field>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field className="flex-1">
            <Label htmlFor="resume">Resume (optional — PDF or Word, up to 5 MB)</Label>
            <Input id="resume" name="resume" type="file" accept={RESUME_ACCEPT} />
          </Field>
          <Field className="w-48">
            <Label htmlFor="stageId">Start in stage</Label>
            <NativeSelect  id="stageId" name="stageId">
              {stages.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field>
          <Label htmlFor="note">Internal note</Label>
          <Textarea id="note" name="note" rows={2} placeholder="e.g. Sent resume on WhatsApp, referred by…" />
        </Field>
        <SubmitButton pendingLabel="Adding…">Add candidate</SubmitButton>
      </DirectUploadForm>

      <details className="mt-10 text-sm">
        <summary className="cursor-pointer rounded-lg border bg-card px-4 py-3 font-medium hover:bg-muted/40">Bulk import from CSV (your old Excel)</summary>
        <div className="rounded-b-lg border border-t-0 bg-card px-4 pb-4">
        <p className="mt-3 text-muted-foreground">
          Save your sheet as CSV with a header row: <code>name,email,phone,status,notes</code>.
          Status can be active, hired, rejected, or withdrawn (defaults to active). Duplicate
          emails are skipped. Imported candidates are tagged with source “import”.
        </p>
        <form action={importCsv} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="openingId" value={openingId} />
          <Input type="file" name="file" aria-label="CSV file" accept=".csv" required className="min-w-48 flex-1" />
          <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
        </form>
        </div>
      </details>
    </div>
  );
}

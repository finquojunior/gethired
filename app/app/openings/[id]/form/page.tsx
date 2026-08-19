import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import type { FormSchema } from '@/lib/form-schema';
import { fetchOpeningQuestions, publishForm, saveDraftForm } from '../../actions';
import FormBuilder from './FormBuilder';

export const dynamic = 'force-dynamic';

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();

  const {
    rows: [draft],
  } = await q<{ schema: FormSchema }>(
    `select schema from public.forms
     where opening_id = $1 and is_published = false
     order by version desc limit 1`,
    [openingId]
  );
  const {
    rows: [published],
  } = await q<{ version: number }>(
    `select version from public.forms where opening_id = $1 and is_published`,
    [openingId]
  );
  const { rows: otherOpenings } = await q<{ id: number; title: string }>(
    `select id, title from public.openings where id <> $1 order by created_at desc limit 30`,
    [openingId]
  );

  return (
    <div>
      <BackButton fallback={`/app/openings/${openingId}`} />
      <div className="track flex items-end justify-between">
        <h1 className="font-display text-3xl font-bold">
          <Link href={`/app/openings/${openingId}`} className="text-ink-soft hover:underline">
            {opening.title}
          </Link>{' '}
          · Form
        </h1>
        <span className="pb-1 text-sm text-ink-soft">
          {published ? `v${published.version} is live` : 'Not published yet'}
        </span>
      </div>
      <div className="mt-8">
        <FormBuilder
          openingId={openingId}
          initialSchema={draft.schema}
          publishedVersion={published?.version ?? null}
          otherOpenings={otherOpenings}
          saveDraft={saveDraftForm}
          publish={publishForm}
          fetchQuestions={fetchOpeningQuestions}
        />
      </div>
    </div>
  );
}

import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { canAccessOpening, currentUser, openingScope, scopeSql } from '@/lib/auth';
import type { FormSchema } from '@/lib/form-schema';
import OpeningTabs from '@/components/OpeningTabs';
import { fetchOpeningQuestions, publishForm, saveDraftForm } from '../../actions';
import FormBuilder from './FormBuilder';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? `${o.title} · Form` : 'Form' };
}

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const openingId = Number(id);
  const {
    rows: [opening],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [openingId]);
  if (!opening) notFound();
  if (!(await canAccessOpening(await currentUser(), openingId))) notFound();

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
    `select id, title from public.openings where id <> $1 and ${scopeSql('id', 2)} order by created_at desc limit 31`,
    [openingId, await openingScope(await currentUser())]
  );
  const moreOpenings = otherOpenings.length > 30;
  if (moreOpenings) otherOpenings.pop();

  return (
    <div>
      <BackButton fallback={`/app/openings/${openingId}`} />
      <div className="track flex items-end justify-between">
        <h1 className="font-display text-3xl font-bold">
          <Link href={`/app/openings/${openingId}`} className="text-muted-foreground hover:underline">
            {opening.title}
          </Link>{' '}
          · Form
        </h1>
        <span className="pb-1 text-sm text-muted-foreground">
          {published ? `v${published.version} is live` : 'Not published yet'}
        </span>
      </div>
      <OpeningTabs openingId={openingId} current="form" />
      {moreOpenings && (
        <p className="mt-2 text-xs text-muted-foreground">&quot;Copy questions from&quot; lists the 30 most recent openings.</p>
      )}
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

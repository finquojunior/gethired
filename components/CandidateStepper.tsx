import { q } from '@/lib/db';

const OUTCOME: Record<string, { text: string; cls: string }> = {
  hired: { text: 'Outcome: offer', cls: 'border-pine bg-pine-wash text-pine-deep' },
  rejected: { text: 'Outcome: not selected', cls: 'border-line bg-paper text-ink-soft' },
  withdrawn: { text: 'Outcome: withdrawn', cls: 'border-line bg-paper text-ink-soft' },
};

// Compact pipeline track for the portal: every stage of the opening in order,
// the candidate's current one highlighted. Final states show the outcome instead.
export default async function CandidateStepper({
  openingId,
  currentStageId,
  status,
  /** rejection email still a draft → don't reveal the outcome yet (C15) */
  hideOutcome,
}: {
  openingId: number;
  currentStageId: number | null;
  status: string;
  hideOutcome?: boolean;
}) {
  const outcome = hideOutcome ? undefined : OUTCOME[status];
  if (outcome) {
    return (
      <p className={`mt-6 inline-block rounded-md border px-3 py-1.5 text-sm font-medium ${outcome.cls}`}>
        {outcome.text}
      </p>
    );
  }
  const { rows: stages } = await q<{ id: number; name: string }>(
    `select id, name from public.stages where opening_id = $1 order by position, id`,
    [openingId]
  );
  if (stages.length === 0) return null;
  const at = Math.max(0, stages.findIndex((s) => s.id === currentStageId));
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-y-2 text-xs font-medium" aria-label="Application progress">
      {stages.map((s, i) => (
        <li key={s.id} className="flex items-center" aria-current={i === at ? 'step' : undefined}>
          <span
            className={`rounded-full border px-2.5 py-1 ${
              i < at
                ? 'border-pine/40 bg-pine-wash text-pine-deep'
                : i === at
                  ? 'border-pine bg-pine text-white'
                  : 'border-line text-ink-soft'
            }`}
          >
            {i < at ? '✓ ' : ''}
            {s.name}
          </span>
          {i < stages.length - 1 && <span className="mx-1.5 text-line" aria-hidden>—</span>}
        </li>
      ))}
    </ol>
  );
}

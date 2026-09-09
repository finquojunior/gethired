import { Check } from 'lucide-react';
import { q } from '@/lib/db';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

const OUTCOME: Record<string, { text: string; cls: string }> = {
  hired: { text: 'Outcome: offer', cls: 'border-primary bg-secondary text-primary' },
  rejected: { text: 'Outcome: not selected', cls: 'text-muted-foreground' },
  withdrawn: { text: 'Outcome: withdrawn', cls: 'text-muted-foreground' },
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
      <Alert className={`mt-6 w-fit ${outcome.cls}`}>
        <AlertTitle>{outcome.text}</AlertTitle>
      </Alert>
    );
  }
  const { rows: stages } = await q<{ id: number; name: string }>(
    `select id, name from public.stages where opening_id = $1 order by position, id`,
    [openingId]
  );
  if (stages.length === 0) return null;
  const at = Math.max(0, stages.findIndex((s) => s.id === currentStageId));
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-y-2" aria-label="Application progress">
      {stages.map((s, i) => (
        <li key={s.id} className="flex items-center" aria-current={i === at ? 'step' : undefined}>
          <Badge variant={i < at ? 'secondary' : i === at ? 'default' : 'outline'}>
            {i < at && <Check aria-hidden />}
            {s.name}
          </Badge>
          {i < stages.length - 1 && <span className="mx-1 h-px w-3 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

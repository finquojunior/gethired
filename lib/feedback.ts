export interface FeedbackStage {
  id: number;
  name: string;
  kind: string;
}

export interface FeedbackForm extends FeedbackStage {
  title: string;
}

/**
 * Which feedback forms a candidate's profile offers.
 *
 * One per stage that can be scored: task stages the candidate reached, interview
 * stages with a completed slot (there the "Mark completed" prompt takes the first
 * rating and this form is for edits and other panel members), plus the stage the
 * candidate is in now — anyone with access to the opening may rate at any stage,
 * which is how screening scores get collected at Applied.
 *
 * The current stage is skipped only for an interview stage that still has a slot
 * waiting to be completed, because there the rating belongs to "Mark completed"
 * and would otherwise be offered twice. When no slot was ever booked that button
 * never renders, so skipping would leave no way to record a verdict at all.
 */
export function feedbackForms(
  stages: FeedbackStage[],
  currentStageId: number | null,
  reachedStageIds: number[],
  slots: Array<{ stageId: number; completed: boolean }>
): FeedbackForm[] {
  const reached = new Set([...reachedStageIds, ...(currentStageId ? [currentStageId] : [])]);
  const completed = new Set(slots.filter((s) => s.completed).map((s) => s.stageId));
  const forms: FeedbackForm[] = stages
    .filter((s) => (s.kind === 'task' && reached.has(s.id)) || (s.kind === 'interview' && completed.has(s.id)))
    .map((s) => ({
      ...s,
      title: s.kind === 'task' ? `Task score · ${s.name}` : `Interview feedback · ${s.name}`,
    }));

  const cur = stages.find((s) => s.id === currentStageId);
  if (!cur || forms.some((f) => f.id === cur.id)) return forms;
  const ratedByCompleting = cur.kind === 'interview' && slots.some((s) => s.stageId === cur.id);
  if (!ratedByCompleting) forms.push({ ...cur, title: `Feedback · ${cur.name}` });
  return forms;
}

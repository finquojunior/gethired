// Which stage a candidate is auto-moved to once a task is scored or an interview
// is completed and rated: the first matching *_review stage after the source stage.
const REVIEW_OF: Record<string, string> = { task: 'task_review', interview: 'interview_review' };

export function nextReviewStage(
  stages: { id: number; kind: string; position: number }[],
  fromStageId: number
): number | null {
  const from = stages.find((s) => s.id === fromStageId);
  const want = from && REVIEW_OF[from.kind];
  if (!from || !want) return null;
  const next = stages
    .filter((s) => s.kind === want && s.position > from.position)
    .sort((a, b) => a.position - b.position)[0];
  return next ? next.id : null;
}

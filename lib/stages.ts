export const STAGE_KINDS = ['screen', 'task', 'task_review', 'interview', 'interview_review', 'offer', 'no_response'] as const;

/**
 * Parking kinds for candidates who stopped responding — unanswered calls and
 * interview invitations that are never booked. Entering one is silent (no mail
 * of any kind) and invisible to the candidate.
 */
export const SILENT_KINDS: readonly string[] = ['no_response'];

/**
 * What the candidate's portal track shows: the silent stages removed, and the
 * highlighted index. Parked in a silent stage, the track stays on the last
 * stage they actually reached, so nothing about it changes while we chase them.
 */
export function visibleTrack<T extends { id: number; kind: string; position: number }>(
  all: T[],
  currentStageId: number | null
): { stages: T[]; at: number } {
  const stages = all.filter((s) => !SILENT_KINDS.includes(s.kind));
  const current = all.find((s) => s.id === currentStageId);
  const at = !current
    ? 0
    : SILENT_KINDS.includes(current.kind)
      ? Math.max(0, stages.filter((s) => s.position < current.position).length - 1)
      : Math.max(0, stages.findIndex((s) => s.id === current.id));
  return { stages, at };
}

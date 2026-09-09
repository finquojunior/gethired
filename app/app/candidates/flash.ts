// Post-redirect flash text for bulkPipeline results (?ok=<intent>:<n>, ?e=…).
// Shared by the pipeline page and the candidate page.
const OK_TEXT: Record<string, (n: number) => string> = {
  move: (n) => `Moved ${n} candidate${n === 1 ? '' : 's'}`,
  reject_send: (n) => `Rejected ${n} — email sent`,
  reject_draft: (n) => `Rejected ${n} — email drafted in Emails`,
  hire: (n) => `Marked ${n} hired — congratulations email sent`,
  restore: (n) => `Restored ${n} to active`,
  withdraw: (n) => `Marked ${n} withdrawn — no email sent`,
  added: () => 'Candidate added',
  saved: () => 'Saved',
  booked: () => 'Interview booked — candidate and interviewer emailed',
  cancelled: () => 'Interview cancelled — candidate and interviewer emailed',
  auto_review: () => 'Scored — moved to the review stage and the candidate has been emailed.',
  interview_done: () => 'Interview marked completed and feedback saved.',
  interview_reopened: () => 'Interview reopened.',
};
const ERR_TEXT: Record<string, string> = {
  rating_required: 'Pick a star rating to mark the interview completed.',
  nothing: 'Nothing changed — no candidates were selected or they were already in that state.',
  taken: 'That slot was just booked by someone else — pick another.',
  invalid: 'Enter a name and a valid email.',
  duplicate: 'Another candidate in this opening already uses that email.',
};

export function pipelineFlash(ok?: string, e?: string): { kind: 'success' | 'error'; message: string } | null {
  if (e && ERR_TEXT[e]) return { kind: 'error', message: ERR_TEXT[e] };
  if (!ok) return null;
  const [intent, n] = ok.split(':');
  const fn = OK_TEXT[intent];
  return fn ? { kind: 'success', message: fn(Number(n) || 0) } : null;
}

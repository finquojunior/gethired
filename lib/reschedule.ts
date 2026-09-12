// Pure rules for changing a booked interview. No node/db imports so tests can load it directly.

/** Candidates may swap slots or ask for another day until this long before the interview. */
export const CHANGE_CUTOFF_MS = 60 * 60_000;

/** True while the candidate may still change (swap or request) this booking. */
export function canChangeBooking(startsAt: Date, now = new Date()): boolean {
  return startsAt.getTime() - now.getTime() > CHANGE_CUTOFF_MS;
}

/** A requested time must be in the future and within a sane horizon (90 days). */
export function isValidRequestedTime(requestedAt: Date, now = new Date()): boolean {
  const delta = requestedAt.getTime() - now.getTime();
  return Number.isFinite(delta) && delta > CHANGE_CUTOFF_MS && delta < 90 * 86_400_000;
}

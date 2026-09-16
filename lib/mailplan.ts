// Which service to try, in order, for one delivery burst. No node imports.
export type MailService = 'resend' | 'gmail';

const otherService = (s: MailService): MailService => (s === 'resend' ? 'gmail' : 'resend');

/**
 * Primary twice, then the other service — skipping anything unconfigured or
 * exhausted (over its sending quota). An exhausted primary hands the primary
 * slot to the other service, so it still gets two tries.
 */
export function sendPlan(
  primary: MailService,
  configured: Record<MailService, boolean>,
  exhausted: Partial<Record<MailService, boolean>> = {}
): MailService[] {
  const usable = (s: MailService) => configured[s] && !exhausted[s];
  if (exhausted[primary]) primary = otherService(primary);
  const other = otherService(primary);
  const plan: MailService[] = [];
  if (usable(primary)) plan.push(primary, primary);
  if (usable(other)) plan.push(other);
  return plan;
}

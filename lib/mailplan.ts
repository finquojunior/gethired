// Which service to try, in order, for one delivery burst. No node imports.
export type MailService = 'resend' | 'gmail';

export const otherService = (s: MailService): MailService => (s === 'resend' ? 'gmail' : 'resend');

/** Primary twice, then the other service — skipping anything unconfigured. */
export function sendPlan(primary: MailService, configured: Record<MailService, boolean>): MailService[] {
  const other = otherService(primary);
  const plan: MailService[] = [];
  if (configured[primary]) plan.push(primary, primary);
  if (configured[other]) plan.push(other);
  return plan;
}

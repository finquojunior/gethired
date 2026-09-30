import { q } from '@/lib/db';
import { portalUrl, sendEmail } from '@/lib/email';

/**
 * Candidates parked on hold (applied while the opening was passive) join the
 * active pipeline and get the "hiring resumed" email with a withdraw link.
 * ids null = everyone on hold in the opening (the opening reopening); a list =
 * staff pulling specific candidates in early.
 */
export async function releaseOnHold(openingId: number, ids: number[] | null): Promise<number> {
  const { rows } = await q<{ id: number; name: string; email: string; portal_token: string; title: string }>(
    `update public.applications a set status = 'active'
     from public.openings o
     where a.opening_id = $1 and a.status = 'on_hold' and o.id = a.opening_id
       and ($2::bigint[] is null or a.id = any($2))
     returning a.id, a.name, a.email, a.portal_token, o.title`,
    [openingId, ids]
  );
  for (const a of rows) {
    await sendEmail({
      applicationId: a.id,
      template: 'hiring_resumed',
      to: a.email,
      vars: { name: a.name, role: a.title, portal_link: portalUrl(a.portal_token) },
    });
  }
  return rows.length;
}

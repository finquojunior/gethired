import { q } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { fmtDateTimeFull } from '@/lib/tz';

/**
 * Free future interview slots held by these applications — except slots in
 * `keepStageId` (pass null to free all) — and email the affected interviewers.
 * Used on reject, withdraw, stage moves, and cancellations.
 */
export async function freeFutureSlots(
  applicationIds: number[],
  keepStageId: number | null
): Promise<number> {
  if (applicationIds.length === 0) return 0;
  const { rows: freed } = await q<{
    application_id: number;
    starts_at: Date;
    name: string;
    title: string;
    interviewer_email: string | null;
  }>(
    `update public.slots sl set application_id = null
     from public.applications a, public.openings o, public.profiles p
     where sl.application_id = any($1)
       and ($2::bigint is null or sl.stage_id is distinct from $2)
       and sl.starts_at > now()
       and a.id = sl.application_id and o.id = a.opening_id and p.id = sl.interviewer_id
     returning a.id as application_id, sl.starts_at, a.name, o.title,
       (select u.email from auth.users u where u.id = p.id) as interviewer_email`,
    [applicationIds, keepStageId]
  );
  for (const f of freed) {
    if (!f.interviewer_email) continue;
    await sendEmail({
      applicationId: f.application_id,
      template: 'interviewer_cancelled',
      to: f.interviewer_email,
      vars: { name: f.name, role: f.title, when: fmtDateTimeFull(f.starts_at) },
    });
  }
  return freed.length;
}

/** Emails for a set of staff ids (panel members) — only those with an email. */
export async function staffEmails(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await q<{ email: string }>(
    `select u.email from auth.users u where u.id = any($1) and u.email is not null`,
    [ids]
  );
  return rows.map((r) => r.email);
}

/** Application ids holding a booking, resolved from a portal token. */
export async function applicationByToken(token: string): Promise<number | null> {
  const {
    rows: [a],
  } = await q<{ id: number }>(`select id from public.applications where portal_token = $1`, [token]);
  return a?.id ?? null;
}

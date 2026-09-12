import { q } from '@/lib/db';
import { appUrl, icsEvent, portalUrl, sendEmail } from '@/lib/email';
import { fmtDateTimeFull } from '@/lib/tz';

/**
 * Free future interview slots held by these applications — except slots in
 * `keepStageId` (pass null to free all) — and email the affected interviewers
 * and, when `notifyCandidate` is set, the candidate (staff-initiated
 * cancellations; the portal self-cancel passes nothing). `slotId` limits the
 * cancellation to one booking. Used on reject, withdraw, stage moves, and
 * cancellations.
 */
export async function freeFutureSlots(
  applicationIds: number[],
  keepStageId: number | null,
  opts: { slotId?: number | null; notifyCandidate?: boolean } = {}
): Promise<number> {
  if (applicationIds.length === 0) return 0;
  const { rows: freed } = await q<{
    application_id: number;
    starts_at: Date;
    name: string;
    email: string;
    portal_token: string;
    title: string;
    interviewer_email: string | null;
  }>(
    `update public.slots sl set application_id = null
     from public.applications a, public.openings o, public.profiles p
     where sl.application_id = any($1)
       and ($2::bigint is null or sl.stage_id is distinct from $2)
       and ($3::bigint is null or sl.id = $3)
       and sl.starts_at > now()
       and a.id = sl.application_id and o.id = a.opening_id and p.id = sl.interviewer_id
     returning a.id as application_id, sl.starts_at, a.name, a.email, a.portal_token, o.title,
       (select u.email from auth.users u where u.id = p.id) as interviewer_email`,
    [applicationIds, keepStageId, opts.slotId ?? null]
  );
  for (const f of freed) {
    const vars = { name: f.name, role: f.title, when: fmtDateTimeFull(f.starts_at) };
    if (f.interviewer_email) {
      await sendEmail({
        applicationId: f.application_id,
        template: 'interviewer_cancelled',
        to: f.interviewer_email,
        vars,
      });
    }
    if (opts.notifyCandidate) {
      await sendEmail({
        applicationId: f.application_id,
        template: 'booking_cancelled',
        to: f.email,
        vars: { ...vars, portal_link: portalUrl(f.portal_token) },
      });
    }
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

export type BookedSlot = {
  starts_at: Date;
  duration_mins: number;
  interviewer: string;
  meeting_link: string;
  interviewer_email: string | null;
  panel: string[];
};

/** `returning` fragment that yields a BookedSlot (alias the slot `sl`, the interviewer profile `p`). */
export const BOOKED_SLOT_COLS = `sl.starts_at, sl.duration_mins, p.full_name as interviewer, sl.meeting_link,
  (select u.email from auth.users u where u.id = p.id) as interviewer_email, sl.panel`;

/**
 * After a slot is booked: confirmation (with .ics) to the candidate, heads-up to the
 * interviewer and panel. `template` lets a reschedule approval use its own wording.
 */
export async function notifyBooking(
  a: { id: number; name: string; email: string; title: string; portal_token?: string },
  slot: BookedSlot,
  template: 'booking_confirmation' | 'reschedule_approved' = 'booking_confirmation'
): Promise<void> {
  const when = fmtDateTimeFull(slot.starts_at);
  const ics = icsEvent({
    title: `Interview — ${a.title}`,
    startsAt: slot.starts_at,
    durationMins: slot.duration_mins,
    description: `Interview with ${slot.interviewer}`,
    ...(/^https?:\/\//.test(slot.meeting_link) ? { url: slot.meeting_link } : {}),
    location: slot.meeting_link,
  });
  await sendEmail({
    applicationId: a.id,
    template,
    to: a.email,
    vars: {
      name: a.name,
      role: a.title,
      when,
      duration: String(slot.duration_mins),
      interviewer: slot.interviewer,
      link: slot.meeting_link,
      portal_link: a.portal_token ? portalUrl(a.portal_token) : '',
    },
    ics,
  });
  const panelEmails = await staffEmails(slot.panel ?? []);
  for (const to of [slot.interviewer_email, ...panelEmails].filter(Boolean) as string[]) {
    await sendEmail({
      applicationId: a.id,
      template: 'interviewer_booked',
      to,
      vars: {
        name: a.name,
        role: a.title,
        when,
        duration: String(slot.duration_mins),
        profile_link: appUrl(`/app/candidates/${a.id}`),
      },
      ics,
    });
  }
}

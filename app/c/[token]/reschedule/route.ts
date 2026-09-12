import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { appUrl, portalUrl, sendEmail } from '@/lib/email';
import { fmtDateTimeFull, orgTimeToUtc } from '@/lib/tz';
import { canChangeBooking, isValidRequestedTime } from '@/lib/reschedule';
import { clientIp, rateLimit } from '@/lib/ratelimit';

/** Candidate asks to move a booked interview to a day/time with no open slot. Staff decide. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);
  if (!rateLimit(`reschedule:${clientIp(req.headers)}`, 5, 10 * 60_000)) return back();
  const fd = await req.formData();
  const date = String(fd.get('date') ?? '');
  const time = String(fd.get('time') ?? '');
  const note = String(fd.get('note') ?? '').trim().slice(0, 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return back('?e=time');
  const requestedAt = orgTimeToUtc(date, time);
  if (!isValidRequestedTime(requestedAt)) return back('?e=time');

  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; portal_token: string; stage_id: number; title: string; slot_id: number; starts_at: Date; interviewer_email: string | null }>(
    `select a.id, a.name, a.email, a.portal_token, a.current_stage_id as stage_id, o.title,
            sl.id as slot_id, sl.starts_at,
            (select u.email from auth.users u where u.id = sl.interviewer_id) as interviewer_email
     from public.applications a
     join public.openings o on o.id = a.opening_id
     join public.slots sl on sl.application_id = a.id and sl.stage_id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a) return back('?e=oops');
  if (!canChangeBooking(a.starts_at)) return back('?e=late');

  try {
    await q(
      `insert into public.reschedule_requests (application_id, slot_id, stage_id, requested_at, note)
       values ($1, $2, $3, $4, $5)`,
      [a.id, a.slot_id, a.stage_id, requestedAt.toISOString(), note]
    );
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return back('?e=pending'); // one open request per stage
    throw e;
  }
  await audit(null, 'reschedule_requested', 'application', a.id, { slotId: a.slot_id, requestedAt: requestedAt.toISOString() });

  const vars = { name: a.name, role: a.title, when: fmtDateTimeFull(a.starts_at), requested: fmtDateTimeFull(requestedAt) };
  await sendEmail({
    applicationId: a.id,
    template: 'reschedule_requested',
    to: a.email,
    vars: { ...vars, portal_link: portalUrl(a.portal_token) },
  });
  if (a.interviewer_email) {
    await sendEmail({
      applicationId: a.id,
      template: 'interviewer_reschedule_requested',
      to: a.interviewer_email,
      vars: { ...vars, note: note || '(none)', requests_link: appUrl('/app/interviews') },
    });
  }
  return back('?ok=requested');
}

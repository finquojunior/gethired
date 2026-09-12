import { NextResponse, type NextRequest } from 'next/server';
import { q, tx } from '@/lib/db';
import { audit } from '@/lib/audit';
import { BOOKED_SLOT_COLS, notifyBooking, type BookedSlot } from '@/lib/slots';
import { sendEmail } from '@/lib/email';
import { fmtDateTimeFull } from '@/lib/tz';
import { CHANGE_CUTOFF_MS } from '@/lib/reschedule';
import { clientIp, rateLimit } from '@/lib/ratelimit';

/** Candidate swaps their booked slot for another open one, in one transaction. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);
  if (!rateLimit(`rebook:${clientIp(req.headers)}`, 10, 5 * 60_000)) return back();
  const slotId = Number((await req.formData()).get('slotId'));

  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; portal_token: string; stage_id: number; title: string; old_id: number; old_starts: Date; old_interviewer_email: string | null }>(
    `select a.id, a.name, a.email, a.portal_token, a.current_stage_id as stage_id, o.title,
            sl.id as old_id, sl.starts_at as old_starts,
            (select u.email from auth.users u where u.id = sl.interviewer_id) as old_interviewer_email
     from public.applications a
     join public.openings o on o.id = a.opening_id
     join public.slots sl on sl.application_id = a.id and sl.stage_id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || !slotId) return back();
  if (a.old_starts.getTime() - Date.now() <= CHANGE_CUTOFF_MS) return back('?e=late');
  if (slotId === a.old_id) return back();

  // release the old slot and claim the new one together; a lost race rolls both back
  const slot = await tx(async (c) => {
    await c.query(`update public.slots set application_id = null where id = $1 and application_id = $2`, [a.old_id, a.id]);
    const { rows } = await c.query<BookedSlot>(
      `update public.slots sl set application_id = $1
       from public.profiles p
       where sl.id = $2 and sl.stage_id = $3 and sl.application_id is null
         and sl.starts_at > now() and p.id = sl.interviewer_id
       returning ${BOOKED_SLOT_COLS}`,
      [a.id, slotId, a.stage_id]
    );
    if (!rows[0]) throw new Error('taken');
    return rows[0];
  }).catch((e) => (String(e.message) === 'taken' ? null : Promise.reject(e)));
  if (!slot) return back('?e=taken');

  await audit(null, 'rebooked_slot', 'application', a.id, { from: a.old_id, to: slotId });
  if (a.old_interviewer_email) {
    await sendEmail({
      applicationId: a.id,
      template: 'interviewer_cancelled',
      to: a.old_interviewer_email,
      vars: { name: a.name, role: a.title, when: fmtDateTimeFull(a.old_starts) },
    });
  }
  await notifyBooking(a, slot);
  return back('?ok=rebooked');
}

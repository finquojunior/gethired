import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { staffEmails } from '@/lib/slots';
import { appUrl, icsEvent, sendEmail } from '@/lib/email';
import { fmtDateTimeFull } from '@/lib/tz';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const fd = await req.formData();
  const slotId = Number(fd.get('slotId'));
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);

  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; stage_id: number | null; title: string }>(
    `select a.id, a.name, a.email, a.current_stage_id as stage_id, o.title
     from public.applications a join public.openings o on o.id = a.opening_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || !a.stage_id || !slotId) return back();

  // one booking per stage: bail if already booked
  const { rowCount: existing } = await q(
    `select 1 from public.slots where application_id = $1 and stage_id = $2`,
    [a.id, a.stage_id]
  );
  if (existing) return back();

  // atomic claim — the where clause loses the slot race gracefully; the unique
  // index loses the "double-click two slots at once" race, caught below
  let slot;
  try {
    ({
      rows: [slot],
    } = await q<{
      starts_at: Date;
      duration_mins: number;
      interviewer: string;
      meeting_link: string;
      interviewer_email: string | null;
      panel: string[];
    }>(
      `update public.slots sl set application_id = $1
       from public.profiles p
       where sl.id = $2 and sl.stage_id = $3 and sl.application_id is null
         and sl.starts_at > now() and p.id = sl.interviewer_id
       returning sl.starts_at, sl.duration_mins, p.full_name as interviewer, sl.meeting_link,
         (select u.email from auth.users u where u.id = p.id) as interviewer_email, sl.panel`,
      [a.id, slotId, a.stage_id]
    ));
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return back(); // already booked
    throw e;
  }
  if (!slot) return back('?e=taken');

  await audit(null, 'booked_slot', 'application', a.id, { slotId });
  const when = fmtDateTimeFull(slot.starts_at);
  const ics = icsEvent({
    title: `Interview — ${a.title}`,
    startsAt: slot.starts_at,
    durationMins: slot.duration_mins,
    description: `Interview with ${slot.interviewer}`,
  });
  await sendEmail({
    applicationId: a.id,
    template: 'booking_confirmation',
    to: a.email,
    vars: {
      name: a.name,
      role: a.title,
      when,
      duration: String(slot.duration_mins),
      interviewer: slot.interviewer,
      link: slot.meeting_link,
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
  return back();
}

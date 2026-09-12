import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { BOOKED_SLOT_COLS, notifyBooking, type BookedSlot } from '@/lib/slots';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const fd = await req.formData();
  const slotId = Number(fd.get('slotId'));
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);

  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; portal_token: string; stage_id: number | null; title: string }>(
    `select a.id, a.name, a.email, a.portal_token, a.current_stage_id as stage_id, o.title
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
    } = await q<BookedSlot>(
      `update public.slots sl set application_id = $1
       from public.profiles p
       where sl.id = $2 and sl.stage_id = $3 and sl.application_id is null
         and sl.starts_at > now() and p.id = sl.interviewer_id
       returning ${BOOKED_SLOT_COLS}`,
      [a.id, slotId, a.stage_id]
    ));
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return back(); // already booked
    throw e;
  }
  if (!slot) return back('?e=taken');

  await audit(null, 'booked_slot', 'application', a.id, { slotId });
  await notifyBooking(a, slot);
  return back('?ok=booked');
}

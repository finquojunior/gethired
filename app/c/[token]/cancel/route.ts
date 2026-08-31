import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { freeFutureSlots } from '@/lib/slots';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const {
    rows: [a],
  } = await q<{ id: number }>(
    // cancellable only while >24h out; the shared free helper handles the rest
    `select a.id from public.applications a
     where a.portal_token = $1 and a.status = 'active'
       and exists (
         select 1 from public.slots sl
         where sl.application_id = a.id and sl.stage_id = a.current_stage_id
           and sl.starts_at > now() + interval '24 hours'
       )`,
    [token]
  );
  if (a) {
    await freeFutureSlots([a.id], null);
    await audit(null, 'cancelled_slot', 'application', a.id);
  }
  return NextResponse.redirect(new URL(`/c/${token}${a ? '?ok=cancelled' : ''}`, req.url), 303);
}

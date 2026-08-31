import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { freeFutureSlots } from '@/lib/slots';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const {
    rows: [a],
  } = await q<{ id: number }>(
    `update public.applications set status = 'withdrawn'
     where portal_token = $1 and status = 'active' returning id`,
    [token]
  );
  if (a) {
    await audit(null, 'withdrew', 'application', a.id);
    await freeFutureSlots([a.id], null);
  }
  return NextResponse.redirect(new URL(`/c/${token}${a ? '?ok=withdrawn' : ''}`, req.url), 303);
}

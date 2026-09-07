import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { freeFutureSlots } from '@/lib/slots';
import { sendEmail } from '@/lib/email';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const {
    rows: [a],
  } = await q<{ id: number; name: string; email: string; title: string }>(
    `update public.applications a set status = 'withdrawn'
     from public.openings o
     where a.portal_token = $1 and a.status = 'active' and o.id = a.opening_id
     returning a.id, a.name, a.email, o.title`,
    [token]
  );
  if (a) {
    await audit(null, 'withdrew', 'application', a.id);
    await freeFutureSlots([a.id], null);
    // confirmation so a mistaken tap can be reported (the template says how)
    await sendEmail({
      applicationId: a.id,
      template: 'withdrawn',
      to: a.email,
      vars: { name: a.name, role: a.title },
    }).catch((e) => console.error('withdrawn email failed', e));
  }
  return NextResponse.redirect(new URL(`/c/${token}${a ? '?ok=withdrawn' : ''}`, req.url), 303);
}

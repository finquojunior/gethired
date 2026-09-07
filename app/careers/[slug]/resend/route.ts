import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { portalUrl, sendEmail } from '@/lib/email';

const NEUTRAL = { ok: true, message: 'If an application exists for this email, the link is on its way.' };

/** "Lost your link?" — re-sends application_received. Same 200 body either way. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (!rateLimit(`resend:${clientIp(req.headers)}`, 5, 15 * 60_000)) {
    return NextResponse.json({ message: 'Too many attempts — try again in a few minutes.' }, { status: 429 });
  }
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? '').trim().toLowerCase().slice(0, 320);
  if (!email) return NextResponse.json(NEUTRAL);

  const {
    rows: [a],
  } = await q<{ id: number; name: string; portal_token: string; title: string }>(
    `select a.id, a.name, a.portal_token, o.title
     from public.applications a join public.openings o on o.id = a.opening_id
     where o.slug = $1 and a.email = $2 and a.status <> 'withdrawn'
     order by a.id desc limit 1`,
    [slug, email]
  );
  if (a) {
    await sendEmail({
      applicationId: a.id,
      template: 'application_received',
      to: email,
      vars: { name: a.name, role: a.title, portal_link: portalUrl(a.portal_token) },
    }).catch((e) => console.error('resend link failed', e));
  }
  return NextResponse.json(NEUTRAL);
}

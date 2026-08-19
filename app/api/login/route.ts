import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { createSession, verifyPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`login:${ip}`, 10, 15 * 60_000)) {
    return NextResponse.redirect(new URL('/login?e=rate', req.url), 303);
  }
  const fd = await req.formData();
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');

  const {
    rows: [user],
  } = await q<{ id: string; password_hash: string }>(
    `select p.id, p.password_hash
     from public.profiles p join auth.users u on u.id = p.id
     where u.email = $1`,
    [email]
  );
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    return NextResponse.redirect(new URL('/login?e=bad', req.url), 303);
  }
  await createSession(user.id);
  await audit(user.id, 'login', 'profile', user.id, { ip });
  return NextResponse.redirect(new URL('/app', req.url), 303);
}

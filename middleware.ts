import { NextResponse, type NextRequest } from 'next/server';

// Fast-path gate for /app: verifies the session cookie signature at the edge
// and bounces obvious unauthenticated traffic to /login. This is convenience,
// NOT the security boundary — every page and action re-verifies server-side
// via currentUser(), so middleware-bypass tricks gain nothing.
const SECRET = process.env.SESSION_SECRET ?? 'dev-secret-do-not-deploy';

async function validSignature(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [userId, expiry, sig] = value.split('.');
  if (!userId || !expiry || !sig || Number(expiry) < Date.now()) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}.${expiry}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sig === expected;
}

export async function middleware(req: NextRequest) {
  if (await validSignature(req.cookies.get('gh_session')?.value)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/app/:path*'],
};

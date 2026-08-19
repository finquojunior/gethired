import { NextResponse, type NextRequest } from 'next/server';
import { logError } from '@/lib/log';
import { clientIp, rateLimit } from '@/lib/ratelimit';

// Sink for error reports from the server hook (instrumentation.ts) and the
// client error boundaries. Accepts unauthenticated posts by design — errors
// from candidates matter too — with hard size caps; reading requires admin.
export async function POST(req: NextRequest) {
  if (!rateLimit(`errlog:${clientIp(req.headers)}`, 20, 5 * 60_000)) {
    return new NextResponse(null, { status: 429 });
  }
  if (Number(req.headers.get('content-length') ?? 0) > 32 * 1024) {
    return new NextResponse(null, { status: 413 });
  }
  let body: { source?: string; message?: string; stack?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const err = new Error(String(body.message ?? 'Unknown error').slice(0, 2000));
  err.stack = String(body.stack ?? '').slice(0, 8000);
  await logError(String(body.source ?? 'unknown').slice(0, 50), err, {
    ...(typeof body.context === 'object' && body.context ? body.context : {}),
    ua: (req.headers.get('user-agent') ?? '').slice(0, 200),
  });
  return NextResponse.json({ ok: true });
}

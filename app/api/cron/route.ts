import { NextResponse, type NextRequest } from 'next/server';
import { runCronWork } from '@/lib/cron-work';

// The scheduled tick. Hit every 15 min by .github/workflows/cron.yml and once a
// day by the vercel.json cron as a fallback. Locally there is no HTTP caller:
// lib/db.ts runs runCronWork on a timer instead.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    return new NextResponse('CRON_SECRET not configured', { status: 503 });
  }
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return NextResponse.json(await runCronWork());
}

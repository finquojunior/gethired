import { NextResponse, type NextRequest } from 'next/server';
import { runCronWork } from '@/lib/cron-work';

// Hourly worker (vercel.json cron). Also runs locally via instrumentation.ts.
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

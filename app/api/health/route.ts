import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export async function GET() {
  try {
    await q('select 1');
    return NextResponse.json({
      ok: true,
      email_configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

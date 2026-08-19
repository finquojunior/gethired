import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export async function GET() {
  try {
    await q('select 1');
    return NextResponse.json({
      ok: true,
      email_configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      storage_configured: Boolean(
        (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
          (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)
      ),
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

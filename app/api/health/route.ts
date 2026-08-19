import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export async function GET() {
  try {
    await q('select 1');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

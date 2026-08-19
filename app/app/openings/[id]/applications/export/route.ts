import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { currentUser, isStaff } from '@/lib/auth';
import { allFields, type FormSchema } from '@/lib/form-schema';

const csv = (v: unknown) => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  // candidate-controlled text: neutralize spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!isStaff(user)) return new NextResponse('Forbidden', { status: 403 });
  const { id } = await ctx.params;
  const openingId = Number(id);

  const { rows: apps } = await q<{
    name: string;
    email: string;
    phone: string;
    score: string | null;
    status: string;
    stage: string | null;
    answers: Record<string, unknown>;
    schema: FormSchema;
    created_at: Date;
  }>(
    `select a.name, a.email, a.phone, a.score, a.status, s.name as stage,
            a.answers, f.schema, a.created_at
     from public.applications a
     join public.forms f on f.id = a.form_id
     left join public.stages s on s.id = a.current_stage_id
     where a.opening_id = $1
     order by a.created_at`,
    [openingId]
  );

  // union of custom questions across form versions, labeled
  const questions = new Map<string, string>();
  for (const a of apps) {
    for (const f of allFields(a.schema)) questions.set(f.id, f.label || f.id);
  }
  const qids = [...questions.keys()];

  const header = ['Name', 'Email', 'Phone', 'Score', 'Status', 'Stage', 'Applied', ...qids.map((k) => questions.get(k)!)];
  const lines = [header.map(csv).join(',')];
  for (const a of apps) {
    lines.push(
      [
        a.name,
        a.email,
        a.phone,
        a.score ?? '',
        a.status,
        a.stage ?? '',
        a.created_at.toISOString().slice(0, 10),
        ...qids.map((k) => a.answers[k]),
      ]
        .map(csv)
        .join(',')
    );
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="applications-${openingId}.csv"`,
    },
  });
}

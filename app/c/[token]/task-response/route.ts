import { NextResponse, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit } from '@/lib/ratelimit';

/** Candidate answers (or changes) "are you doing this task?" — yes/no. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const back = (suffix = '') => NextResponse.redirect(new URL(`/c/${token}${suffix}`, req.url), 303);
  if (!rateLimit(`task-response:${clientIp(req.headers)}`, 10, 5 * 60_000)) return back();

  const {
    rows: [a],
  } = await q<{ id: number; stage_id: number | null; kind: string | null }>(
    `select a.id, a.current_stage_id as stage_id, s.kind
     from public.applications a
     left join public.stages s on s.id = a.current_stage_id
     where a.portal_token = $1 and a.status = 'active'`,
    [token]
  );
  if (!a || a.kind !== 'task') return back();

  const response = String((await req.formData()).get('response'));
  if (response !== 'yes' && response !== 'no') return back();

  // append-only: only insert when it actually changes, so the timeline stays clean
  const {
    rows: [current],
  } = await q<{ response: string }>(
    `select response from public.task_responses
     where application_id = $1 and stage_id = $2 order by id desc limit 1`,
    [a.id, a.stage_id]
  );
  if (current?.response !== response) {
    await q(
      `insert into public.task_responses (application_id, stage_id, response) values ($1, $2, $3)`,
      [a.id, a.stage_id, response]
    );
    await audit(null, 'task_response', 'application', a.id, { response });
  }
  return back('?ok=response');
}

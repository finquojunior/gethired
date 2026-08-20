// Shared between the pipeline list page and the candidate page's prev/next
// arrows, so "next" always matches the exact row order the reviewer saw.

// fixed order-by fragments only — never user input
export const PIPELINE_SORTS: Record<string, string> = {
  score: 'a.score desc nulls last, a.created_at desc',
  feedback: 'fb.avg_rating desc nulls last, a.created_at desc',
  newest: 'a.created_at desc',
  oldest: 'a.created_at asc',
  name: 'a.name asc',
};

// params: [openingId, stageId|null, status, from|null, to|null]
export const PIPELINE_WHERE = `a.opening_id = $1
  and ($2::bigint is null or a.current_stage_id = $2)
  and a.status = $3
  and ($4::date is null or a.created_at >= $4::date)
  and ($5::date is null or a.created_at < $5::date + 1)`;

export const FEEDBACK_JOIN = `left join (
  select application_id, avg(rating) as avg_rating, count(*)::int as rating_count
  from public.feedback where rating is not null group by application_id
) fb on fb.application_id = a.id`;

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export type PipelineCtx = { stage?: string; status?: string; from?: string; to?: string; sort?: string };

/** Query-string carrying the list's filter context into a candidate link. */
export function pipelineCtxParams(openingId: number, ctx: PipelineCtx): string {
  const p = new URLSearchParams({ o: String(openingId) });
  for (const k of ['stage', 'status', 'from', 'to', 'sort'] as const) {
    if (ctx[k]) p.set(k, ctx[k]!);
  }
  return p.toString();
}

/** Bound params for the pipeline WHERE clause. */
export function pipelineParams(openingId: number, ctx: PipelineCtx): (string | number | null)[] {
  return [
    openingId,
    ctx.stage ? Number(ctx.stage) : null,
    ctx.status || 'active',
    ctx.from && isDate(ctx.from) ? ctx.from : null,
    ctx.to && isDate(ctx.to) ? ctx.to : null,
  ];
}

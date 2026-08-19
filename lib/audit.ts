import { q } from '@/lib/db';

/** actorId null = a candidate action (identified by entity/entity_id). */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | number,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await q(
    `insert into public.audit_log (actor_id, action, entity, entity_id, detail)
     values ($1, $2, $3, $4, $5)`,
    [actorId, action, entity, String(entityId), JSON.stringify(detail)]
  );
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(
  __dirname,
  '../supabase/migrations/20260909090000_review_stages.sql'
);

test('review_stages migration is idempotent and every task/interview stage is followed by its review stage', async (t) => {
  const c = new Client({
    host: '127.0.0.1',
    port: 54322,
    user: 'postgres',
    database: 'gethired',
    connectionTimeoutMillis: 1500,
  });
  try {
    await c.connect();
  } catch {
    t.skip('local Postgres not running');
    return;
  }
  try {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    // Replay the backfill block only. The migration's leading DDL re-declares
    // stages_kind_check with the kind list as of its own date, so replaying it
    // verbatim against head would reject kinds that later migrations added
    // (e.g. 'no_response'). The backfill is what this test is about.
    const start = sql.indexOf('do $$');
    assert.notEqual(start, -1, 'backfill block not found in the migration');
    const backfill = sql.slice(start);

    // In a transaction we roll back, so the test never mutates the dev database.
    await c.query('begin');
    const before = await c.query('select count(*)::int as n from public.stages');
    await c.query(backfill);
    const after = await c.query('select count(*)::int as n from public.stages');
    assert.equal(
      after.rows[0].n,
      before.rows[0].n,
      'reapplying the migration should be a no-op (idempotent backfill)'
    );

    const { rows: badPositions } = await c.query(`
      select opening_id from public.stages
      group by opening_id
      having min(position) <> 0 or max(position) <> count(*) - 1
    `);
    assert.equal(
      badPositions.length,
      0,
      `openings with a non-contiguous 0..n-1 position sequence: ${JSON.stringify(badPositions)}`
    );

    const { rows: badPairs } = await c.query(`
      select opening_id, kind, position, next_kind from (
        select opening_id, kind, position,
               lead(kind) over (partition by opening_id order by position) as next_kind
        from public.stages
      ) t
      where (kind = 'task' and next_kind is distinct from 'task_review')
         or (kind = 'interview' and next_kind is distinct from 'interview_review')
    `);
    assert.equal(
      badPairs.length,
      0,
      `task/interview stages not immediately followed by their review stage: ${JSON.stringify(badPairs)}`
    );
  } finally {
    await c.query('rollback').catch(() => {});
    await c.end();
  }
});

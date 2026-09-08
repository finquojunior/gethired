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

    const before = await c.query('select count(*)::int as n from public.stages');
    await c.query(sql);
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
    await c.end();
  }
});

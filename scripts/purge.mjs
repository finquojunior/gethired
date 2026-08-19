#!/usr/bin/env node
// Data retention: anonymize rejected/withdrawn candidates older than N days.
// Deletes their resume + task files and strips PII; keeps the row for stats.
// Usage: node scripts/purge.mjs <days> [--dry-run]

import { rmSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const days = Number(process.argv[2]);
const dryRun = process.argv.includes('--dry-run');
if (!Number.isInteger(days) || days < 30) {
  console.error('usage: node scripts/purge.mjs <days >= 30> [--dry-run]');
  process.exit(1);
}

const FILES_ROOT = path.join(process.cwd(), 'db', 'files');
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54322/gethired',
});
await c.connect();

const { rows } = await c.query(
  `select a.id, a.email, a.resume_path,
          array(select file_path from public.submissions s where s.application_id = a.id) as submission_paths
   from public.applications a
   where a.status in ('rejected', 'withdrawn')
     and a.updated_at < now() - make_interval(days => $1)
     and a.email not like 'purged-%'`,
  [days]
);

console.log(`${rows.length} candidates to anonymize (${dryRun ? 'dry run' : 'executing'})`);
for (const r of rows) {
  console.log(` - #${r.id} ${r.email}`);
  if (dryRun) continue;
  for (const p of [r.resume_path, ...r.submission_paths].filter(Boolean)) {
    rmSync(path.join(FILES_ROOT, p), { force: true });
  }
  await c.query(
    `update public.applications set
       name = 'Removed candidate', email = 'purged-' || id || '@removed.invalid',
       phone = '', resume_path = '', answers = '{}', utm = '{}'
     where id = $1`,
    [r.id]
  );
  await c.query(`update public.submissions set file_path = '', note = '' where application_id = $1`, [r.id]);
  await c.query(`delete from public.email_log where application_id = $1`, [r.id]);
}
console.log(dryRun ? 'dry run complete' : 'purge complete');
await c.end();

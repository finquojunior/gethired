#!/usr/bin/env node
// Local dev Postgres runner: project-local binaries (embedded-postgres),
// data in db/data, port 54322. Applies db/shim.sql + supabase/migrations/*.
// Usage: node scripts/db.mjs <start|stop|reset|migrate|check>

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (() => {
  const base = path.join(ROOT, 'node_modules', '@embedded-postgres');
  const platform = readdirSync(base).find((d) => !d.startsWith('.'));
  return path.join(base, platform, 'native', 'bin');
})();
const DATA = path.join(ROOT, 'db', 'data');
const LOG = path.join(ROOT, 'db', 'postgres.log');
const PORT = 54322;
const DB = 'gethired';
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

const run = (cmd, args) =>
  execFileSync(path.join(BIN, cmd), args, { stdio: 'inherit' });

const client = async (database) => {
  const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database });
  await c.connect();
  return c;
};

function isRunning() {
  try {
    execFileSync(path.join(BIN, 'pg_ctl'), ['status', '-D', DATA], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function start() {
  if (!existsSync(DATA)) {
    run('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  }
  if (!isRunning()) {
    run('pg_ctl', ['start', '-w', '-D', DATA, '-l', LOG, '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`]);
  }
}

function stop() {
  if (isRunning()) run('pg_ctl', ['stop', '-D', DATA, '-m', 'fast']);
}

async function ensureDb(name) {
  const c = await client('postgres');
  const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [name]);
  if (!rowCount) await c.query(`create database ${name}`);
  await c.end();
}

async function migrate(database = DB) {
  const c = await client(database);
  try {
    await c.query(readFileSync(path.join(ROOT, 'db', 'shim.sql'), 'utf8'));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const { rowCount } = await c.query('select 1 from private.migrations where name = $1', [f]);
      if (rowCount) continue;
      console.log(`applying ${f}`);
      await c.query('begin');
      try {
        await c.query(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await c.query('insert into private.migrations (name) values ($1)', [f]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    }
    if (database === DB) {
      // dev admin login: dev-admin@example.com / devadmin (local only)
      const { randomBytes, scryptSync } = await import('node:crypto');
      const salt = randomBytes(16).toString('hex');
      const hash = `${salt}:${scryptSync('devadmin', salt, 64).toString('hex')}`;
      const dev = '00000000-0000-0000-0000-000000000001';
      await c.query(
        `insert into auth.users (id, email) values ($1, 'dev-admin@example.com')
         on conflict (id) do update set email = excluded.email`,
        [dev]
      );
      await c.query(
        `insert into public.profiles (id, full_name, role, password_hash)
         values ($1, 'Dev Admin', 'admin', $2)
         on conflict (id) do update set password_hash = excluded.password_hash`,
        [dev, hash]
      );
    }
  } finally {
    await c.end();
  }
}

// smoke test on a throwaway database: schema applies cleanly and RLS holds
async function check() {
  const tmp = `${DB}_check`;
  const admin = await client('postgres');
  await admin.query(`drop database if exists ${tmp}`);
  await admin.query(`create database ${tmp}`);
  await admin.end();
  const c = await client(tmp);
  try {
    await migrate(tmp);
    const uid = (await c.query('select extensions.gen_random_uuid() id')).rows[0].id;
    await c.query('insert into auth.users (id) values ($1)', [uid]);
    await c.query(`insert into public.profiles (id, full_name, role) values ($1, 'HR', 'hr')`, [uid]);
    await c.query(`insert into public.openings (slug, title) values ('eng', 'Engineer')`);
    await c.query(`insert into public.forms (opening_id) select id from public.openings`);
    const { rows: [app] } = await c.query(
      `insert into public.applications (opening_id, form_id, name, email)
       select o.id, f.id, 'Cand', 'c@x.com' from public.openings o join public.forms f on f.opening_id = o.id
       returning portal_token`
    );
    assert(app.portal_token.length === 64, 'portal_token generated');

    // anonymous authenticated user (no profile) sees nothing
    await c.query(`set role authenticated`);
    let n = (await c.query('select count(*)::int n from public.applications')).rows[0].n;
    assert(n === 0, 'RLS blocks user without profile');

    // hr sees the application
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    n = (await c.query('select count(*)::int n from public.applications')).rows[0].n;
    assert(n === 1, 'RLS allows hr');
    await c.query('reset role');
  } finally {
    await c.end();
    const admin2 = await client('postgres');
    await admin2.query(`drop database if exists ${tmp}`);
    await admin2.end();
  }
  console.log('db check: all assertions passed');
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok: ${msg}`);
}

const cmd = process.argv[2];
switch (cmd) {
  case 'start':
    start();
    await ensureDb(DB);
    await migrate();
    console.log(`postgres running on 127.0.0.1:${PORT}, database "${DB}"`);
    break;
  case 'stop':
    stop();
    break;
  case 'reset':
    stop();
    rmSync(DATA, { recursive: true, force: true });
    start();
    await ensureDb(DB);
    await migrate();
    console.log('database reset and migrated');
    break;
  case 'migrate':
    await migrate();
    break;
  case 'check':
    await check();
    break;
  default:
    console.error('usage: node scripts/db.mjs <start|stop|reset|migrate|check>');
    process.exit(1);
}

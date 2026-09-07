import pg, { Pool, type QueryResultRow } from 'pg';

// int8 comes back as a string by default; our ids never exceed 2^53
pg.types.setTypeParser(20, (v) => Number(v));

// Direct Postgres from the server (hosted Supabase in production, embedded
// locally); never exposed to the client. On serverless, DATABASE_URL must be
// the pooled (pgbouncer) connection string.
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54322/gethired',
});

pool.on('error', (err) => console.error('pg pool error', err));

// Local/self-hosted cron ticker: this module only ever loads in the Node
// server (every page imports it), so the timer starts with the first request.
// Skipped on Vercel, where /api/cron is hit every 15 min by
// .github/workflows/cron.yml and daily by the vercel.json cron as a fallback.
declare global {
  // eslint-disable-next-line no-var
  var __gethiredCron: ReturnType<typeof setInterval> | undefined;
}
if (
  !process.env.VERCEL &&
  !process.env.DISABLE_LOCAL_CRON &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  !globalThis.__gethiredCron
) {
  globalThis.__gethiredCron = setInterval(() => {
    import('@/lib/cron-work')
      .then((m) => m.runCronWork())
      .catch((e) => console.error('cron tick failed', e));
  }, 5 * 60_000);
  globalThis.__gethiredCron.unref?.();
}

export function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params as never);
}

export async function tx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

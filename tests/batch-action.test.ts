import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCH, runBatched } from '../lib/batch-action.ts';

const form = (n: number) => {
  const fd = new FormData();
  fd.append('intent', 'pool');
  for (let i = 1; i <= n; i++) fd.append('appId', String(i));
  return fd;
};

test('small selections go in one call, untouched', async () => {
  const calls: FormData[] = [];
  const fd = form(BATCH);
  const r = await runBatched(async (f) => (calls.push(f), { ok: `pool:${BATCH}` }), fd);
  assert.deepEqual(r, { ok: `pool:${BATCH}` });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], fd);
});

test('large selections are batched and their counts summed', async () => {
  const seen: string[][] = [];
  const r = await runBatched(async (f) => {
    seen.push(f.getAll('appId') as string[]);
    assert.equal(f.get('intent'), 'pool');
    // the middle batch was already pooled by someone else
    return seen.length === 2 ? { error: 'nothing' } : { ok: `pool:${f.getAll('appId').length}` };
  }, form(12));
  const sizes = Array.from({ length: Math.ceil(12 / BATCH) }, (_, i) => Math.min(BATCH, 12 - i * BATCH));
  assert.deepEqual(seen.map((s) => s.length), sizes);
  assert.deepEqual(seen.flat(), Array.from({ length: 12 }, (_, i) => String(i + 1)));
  assert.deepEqual(r, { ok: `pool:${12 - sizes[1]}` });
});

test('a real error stops the run; all-nothing stays nothing', async () => {
  let calls = 0;
  const r = await runBatched(async () => (calls++, { error: 'assignee' }), form(12));
  assert.deepEqual(r, { error: 'assignee' });
  assert.equal(calls, 1);
  assert.deepEqual(await runBatched(async () => ({ error: 'nothing' }), form(12)), { error: 'nothing' });
});

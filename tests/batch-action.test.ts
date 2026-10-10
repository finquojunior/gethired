import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatched } from '../lib/batch-action.ts';

const form = (n: number) => {
  const fd = new FormData();
  fd.append('intent', 'pool');
  for (let i = 1; i <= n; i++) fd.append('appId', String(i));
  return fd;
};

test('small selections go in one call, untouched', async () => {
  const calls: FormData[] = [];
  const fd = form(5);
  const r = await runBatched(async (f) => (calls.push(f), { ok: 'pool:5' }), fd);
  assert.deepEqual(r, { ok: 'pool:5' });
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
  assert.deepEqual(seen.map((s) => s.length), [5, 5, 2]);
  assert.deepEqual(seen.flat(), Array.from({ length: 12 }, (_, i) => String(i + 1)));
  assert.deepEqual(r, { ok: 'pool:7' });
});

test('a real error stops the run; all-nothing stays nothing', async () => {
  let calls = 0;
  const r = await runBatched(async () => (calls++, { error: 'assignee' }), form(12));
  assert.deepEqual(r, { error: 'assignee' });
  assert.equal(calls, 1);
  assert.deepEqual(await runBatched(async () => ({ error: 'nothing' }), form(12)), { error: 'nothing' });
});

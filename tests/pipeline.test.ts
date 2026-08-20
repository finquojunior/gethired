import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIPELINE_SORTS, pipelineCtxParams, pipelineParams } from '../lib/pipeline.ts';

test('pipelineCtxParams keeps only set filters, always carries opening id', () => {
  assert.equal(pipelineCtxParams(7, {}), 'o=7');
  assert.equal(
    pipelineCtxParams(7, { stage: '3', status: 'rejected', sort: 'name', from: '', to: '' }),
    'o=7&stage=3&status=rejected&sort=name'
  );
});

test('pipelineParams matches the list defaults', () => {
  assert.deepEqual(pipelineParams(7, {}), [7, null, 'active', null, null]);
  assert.deepEqual(
    pipelineParams(7, { stage: '3', status: 'hired', from: '2026-01-01', to: 'garbage' }),
    [7, 3, 'hired', '2026-01-01', null]
  );
});

test('every sort key is a fixed fragment', () => {
  for (const v of Object.values(PIPELINE_SORTS)) assert.match(v, /^[a-z_.,() ]+$/);
  assert.ok(PIPELINE_SORTS.feedback.includes('fb.avg_rating'));
});

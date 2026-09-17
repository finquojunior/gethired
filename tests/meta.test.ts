import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestTraffic } from '../lib/meta.ts';

test('staff and +test addresses are excluded from conversions', () => {
  assert.equal(isTestTraffic('nahyan@finquo.ai'), true);
  assert.equal(isTestTraffic('Someone@FINQUO.AI'), true);
  assert.equal(isTestTraffic('me+test@gmail.com'), true);
  assert.equal(isTestTraffic('candidate@gmail.com'), false);
});

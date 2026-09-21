import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleBundleError } from '../lib/stale-bundle.ts';

test('recognises deploy-skew errors and nothing else', () => {
  assert.equal(isStaleBundleError({ name: 'TypeError', message: 'e[o] is not a function' }), true);
  assert.equal(isStaleBundleError({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed' }), true);
  assert.equal(isStaleBundleError({ message: 'Failed to find Server Action "abc". This request might be from an older or newer deployment.' }), true);
  assert.equal(isStaleBundleError({ message: 'relation "public.nope" does not exist' }), false);
  assert.equal(isStaleBundleError({ message: 'router.refresh is not a function' }), false);
  assert.equal(isStaleBundleError({}), false);
});

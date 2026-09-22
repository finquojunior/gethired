import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assigneeTint } from '../lib/assignee.ts';

const A = '0f2c1c9e-1b7e-4a5b-9d3c-1f5c1b0e2a11';
const B = '8a1d6f2c-5e3b-4c8d-a2f1-7b9e0c4d3a22';

test('same user always gets the same tint', () => {
  assert.equal(assigneeTint(A), assigneeTint(A));
});
test('tints are low-alpha hsl from the fixed 10-hue palette', () => {
  for (const id of [A, B, 'x', '']) {
    const m = assigneeTint(id).match(/^hsl\((\d+) 70% 55% \/ 0\.22\)$/);
    assert.ok(m, assigneeTint(id));
    assert.equal(Number(m![1]) % 36, 0);
  }
});
test('different users usually differ', () => {
  assert.notEqual(assigneeTint(A), assigneeTint(B));
});

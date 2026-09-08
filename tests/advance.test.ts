import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReviewStage } from '../lib/advance.ts';

const stages = [
  { id: 1, kind: 'screen', position: 0 },
  { id: 2, kind: 'task', position: 1 },
  { id: 3, kind: 'task_review', position: 2 },
  { id: 4, kind: 'interview', position: 3 },
  { id: 5, kind: 'interview_review', position: 4 },
  { id: 6, kind: 'offer', position: 5 },
];

test('task stage advances to the first task_review after it', () => {
  assert.equal(nextReviewStage(stages, 2), 3);
});
test('interview stage advances to the first interview_review after it, skipping other kinds', () => {
  assert.equal(nextReviewStage([...stages.slice(0, 4), { id: 9, kind: 'screen', position: 4 }, stages[4]], 4), 5);
});
test('no matching review stage after it → null', () => {
  assert.equal(nextReviewStage(stages.filter((s) => s.id !== 5), 4), null);
  assert.equal(nextReviewStage(stages, 1), null); // screen never auto-advances
  assert.equal(nextReviewStage(stages, 99), null);
});
test('a review stage before the source stage does not count', () => {
  assert.equal(nextReviewStage([{ id: 3, kind: 'task_review', position: 0 }, { id: 2, kind: 'task', position: 1 }], 2), null);
});

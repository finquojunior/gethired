import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackForms } from '../lib/feedback.ts';

// mirrors the "Online Tutors - US Shift" opening (task stages were deleted there)
const stages = [
  { id: 1, name: 'Applied', kind: 'screen' },
  { id: 2, name: 'Shortlist', kind: 'screen' },
  { id: 3, name: 'Task', kind: 'task' },
  { id: 4, name: 'Interview', kind: 'interview' },
  { id: 5, name: 'Interview review', kind: 'interview_review' },
  { id: 8, name: 'No response', kind: 'no_response' },
];
const titles = (f: ReturnType<typeof feedbackForms>) => f.map((x) => x.title);

test('screening: a candidate sitting in Applied can always be rated', () => {
  assert.deepEqual(titles(feedbackForms(stages, 1, [], [])), ['Feedback · Applied']);
});

// the regression: Vanitha Bai / Farzeenabeevi Es — moved to Interview, never booked
test('in an interview stage with no slot booked, the rating form is still offered', () => {
  const forms = feedbackForms(stages, 4, [], []);
  assert.deepEqual(titles(forms), ['Feedback · Interview']);
});

test('with a slot still to complete, rating belongs to "Mark completed" — no duplicate form', () => {
  const forms = feedbackForms(stages, 4, [], [{ stageId: 4, completed: false }]);
  assert.deepEqual(titles(forms), []);
});

test('once the interview is completed, the form appears for edits and other panel members', () => {
  const forms = feedbackForms(stages, 4, [], [{ stageId: 4, completed: true }]);
  assert.deepEqual(titles(forms), ['Interview feedback · Interview']);
  // and it is not also added a second time as the current stage
  assert.equal(forms.length, 1);
});

test('a task stage reached keeps its score form after the candidate moves on', () => {
  const forms = feedbackForms(stages, 5, [3], [{ stageId: 4, completed: true }]);
  assert.deepEqual(titles(forms), [
    'Task score · Task',
    'Interview feedback · Interview',
    'Feedback · Interview review',
  ]);
});

test('parked in No response, a verdict can still be recorded', () => {
  assert.deepEqual(titles(feedbackForms(stages, 8, [], [])), ['Feedback · No response']);
});

test('no current stage yields no form (known gap, tracked separately)', () => {
  assert.deepEqual(titles(feedbackForms(stages, null, [], [])), []);
});

test('a slot in some other stage does not suppress the current stage form', () => {
  const forms = feedbackForms(stages, 4, [], [{ stageId: 99, completed: false }]);
  assert.deepEqual(titles(forms), ['Feedback · Interview']);
});

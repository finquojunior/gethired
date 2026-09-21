import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_KINDS, SILENT_KINDS, isSilentStage, visibleTrack } from '../lib/stages.ts';
import { DEFAULT_TEMPLATES } from '../lib/email-templates.ts';

const stages = [
  { id: 1, name: 'Applied', kind: 'screen', position: 0 },
  { id: 2, name: 'Shortlist', kind: 'screen', position: 1 },
  { id: 3, name: 'Interview', kind: 'interview', position: 2 },
  { id: 4, name: 'Offer', kind: 'offer', position: 3 },
  { id: 5, name: 'No response', kind: 'no_response', position: 4 },
];

test('no_response is a valid, silent stage kind', () => {
  assert.ok((STAGE_KINDS as readonly string[]).includes('no_response'));
  assert.ok(SILENT_KINDS.includes('no_response'));
});

test('the candidate track never shows a silent stage', () => {
  const { stages: shown } = visibleTrack(stages, 3);
  assert.deepEqual(shown.map((s) => s.name), ['Applied', 'Shortlist', 'Interview', 'Offer']);
});

test('parked in No response, the track stays on the last stage actually reached', () => {
  assert.equal(visibleTrack(stages, 5).at, 3); // Offer — the stage before it
  assert.equal(visibleTrack(stages, 3).at, 2); // a normal stage highlights itself
});

test('a silent stage placed mid-track does not shift the highlight past it', () => {
  // the non-booker route: parked straight out of the interview stage
  const mid = [...stages.slice(0, 3), { id: 5, name: 'No response', kind: 'no_response', position: 3 }];
  assert.equal(visibleTrack(mid, 5).at, 2); // still shows Interview
  const first = [{ id: 5, name: 'No response', kind: 'no_response', position: 0 }, ...stages.slice(0, 2)];
  assert.equal(visibleTrack(first, 5).at, 0); // nothing reached yet → clamps to the first
});

test('no_response_rejection covers both routes without naming a channel', () => {
  const t = DEFAULT_TEMPLATES.no_response_rejection;
  assert.ok(t);
  assert.deepEqual(t.vars, ['name', 'role', 'careers_link']);
  assert.match(t.body, /connect or hear back/);
  assert.match(t.body, /\{\{careers_link\}\}/);
  assert.match(t.subject, /\{\{role\}\}/);
  // phone-specific wording would be wrong for candidates who never booked a slot
  assert.doesNotMatch(t.body, /phone|call(ed)?\b|twice|two separate/i);
});

test('no stale unreachable_* names survive the rename', () => {
  assert.equal(DEFAULT_TEMPLATES.unreachable_rejection, undefined);
  assert.ok(!(STAGE_KINDS as readonly string[]).includes('unreachable'));
});

test('isSilentStage drives the parked UI and tolerates a missing stage', () => {
  assert.equal(isSilentStage('no_response'), true);
  assert.equal(isSilentStage('interview'), false);
  assert.equal(isSilentStage('screen'), false);
  // a candidate with no current stage must not read as parked
  assert.equal(isSilentStage(null), false);
  assert.equal(isSilentStage(undefined), false);
});

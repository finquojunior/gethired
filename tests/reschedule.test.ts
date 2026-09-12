import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canChangeBooking, isValidRequestedTime } from '../lib/reschedule.ts';
import { DEFAULT_TEMPLATES } from '../lib/email-templates.ts';

const now = new Date('2026-09-12T10:00:00Z');
const at = (mins: number) => new Date(now.getTime() + mins * 60_000);

test('booking can be changed until 1 hour before, not after', () => {
  assert.equal(canChangeBooking(at(61), now), true);
  assert.equal(canChangeBooking(at(60), now), false);
  assert.equal(canChangeBooking(at(-5), now), false);
});

test('requested time must be more than an hour out and under 90 days', () => {
  assert.equal(isValidRequestedTime(at(30), now), false);
  assert.equal(isValidRequestedTime(at(120), now), true);
  assert.equal(isValidRequestedTime(at(91 * 24 * 60), now), false);
  assert.equal(isValidRequestedTime(new Date(NaN), now), false);
});

test('reschedule and no-show templates exist with the vars the code supplies', () => {
  const expect: Record<string, string[]> = {
    reschedule_requested: ['name', 'role', 'when', 'requested', 'portal_link'],
    reschedule_approved: ['name', 'role', 'when', 'duration', 'interviewer', 'link', 'portal_link'],
    reschedule_rejected: ['name', 'role', 'when', 'requested', 'reason', 'portal_link'],
    no_show: ['name', 'role', 'when', 'careers_link'],
    interviewer_reschedule_requested: ['name', 'role', 'when', 'requested', 'note', 'requests_link'],
  };
  for (const [k, vars] of Object.entries(expect)) {
    const t = DEFAULT_TEMPLATES[k];
    assert.ok(t, `${k} missing`);
    assert.deepEqual(t.vars, vars, `${k} vars`);
    for (const v of vars) assert.match(t.body + t.subject, new RegExp(`\\{\\{${v}\\}\\}`), `${k} uses ${v}`);
  }
});

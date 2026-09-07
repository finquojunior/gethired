import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, fmtDateTimeFull, fmtSlot, fmtTime, gcalUrl } from '../lib/tz.ts';

test('candidate-facing times carry a zone name', () => {
  const d = new Date('2026-09-10T04:30:00Z'); // 10:00 IST
  assert.match(fmtSlot(d), /IST|GMT\+5:30/);
  assert.match(fmtDateTimeFull(d), /Thursday.*2026.*(IST|GMT\+5:30)/);
  assert.match(fmtTime(d), /10:00/);
});

test('daysUntil counts org-local calendar days', () => {
  assert.equal(daysUntil(new Date()), 0);
  assert.equal(daysUntil(new Date(Date.now() + 3 * 86_400_000)), 3);
  assert.equal(daysUntil(new Date(Date.now() - 2 * 86_400_000)), -2);
});

test('gcalUrl encodes a TEMPLATE event with UTC bounds', () => {
  const u = new URL(gcalUrl({ title: 'Interview — X', startsAt: new Date('2026-09-10T04:30:00Z'), durationMins: 45, details: 'Join: https://meet' }));
  assert.equal(u.hostname, 'calendar.google.com');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20260910T043000Z/20260910T051500Z');
  assert.equal(u.searchParams.get('details'), 'Join: https://meet');
});

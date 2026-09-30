import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATES } from '../lib/email-templates.ts';

test('review templates exist with the vars notifyStage supplies', () => {
  for (const k of ['task_review', 'interview_review']) {
    const t = DEFAULT_TEMPLATES[k];
    assert.ok(t, `${k} missing`);
    assert.deepEqual(t.vars, ['name', 'role', 'portal_link']);
    assert.match(t.body, /under review/);
    assert.match(t.body, /\{\{portal_link\}\}/);
  }
});

test('talent-pool and passive-opening templates exist with the vars their senders supply', () => {
  assert.deepEqual(DEFAULT_TEMPLATES.kept_on_file.vars, ['name', 'role', 'careers_link']);
  assert.match(DEFAULT_TEMPLATES.kept_on_file.body, /keep it on file/);
  assert.deepEqual(DEFAULT_TEMPLATES.application_received_passive.vars, ['name', 'role', 'portal_link']);
  assert.match(DEFAULT_TEMPLATES.application_received_passive.body, /not hiring for this role immediately/);
  assert.deepEqual(DEFAULT_TEMPLATES.hiring_resumed.vars, ['name', 'role', 'portal_link']);
  assert.match(DEFAULT_TEMPLATES.hiring_resumed.body, /withdraw/);
});

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

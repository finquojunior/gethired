import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATES } from '../lib/email.ts';

test('review templates exist with the vars notifyStage supplies', () => {
  for (const k of ['task_review', 'interview_review']) {
    const t = DEFAULT_TEMPLATES[k];
    assert.ok(t, `${k} missing`);
    // DEFAULT_TEMPLATES appends 'org'/'support_email' to every entry's vars at module
    // load (lib/email.ts, for the settings-page vars hint) — check the notifyStage-supplied
    // vars specifically, not the mutated tail every template shares.
    assert.deepEqual(t.vars.slice(0, 3), ['name', 'role', 'portal_link']);
    assert.match(t.body, /under review/);
    assert.match(t.body, /\{\{portal_link\}\}/);
  }
});

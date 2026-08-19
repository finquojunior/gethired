import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleFields,
  validateAnswers,
  computeScore,
  computeMaxScore,
  type FormSchema,
} from '../lib/form-schema.ts';

const schema: FormSchema = {
  pages: [
    {
      title: 'Basics',
      fields: [
        { id: 'exp', type: 'yes_no', label: 'Any experience?', required: true, points: { Yes: 10 } },
        {
          id: 'years',
          type: 'number',
          label: 'Years',
          required: true,
          showIf: { fieldId: 'exp', op: 'eq', value: 'Yes' },
        },
        {
          id: 'stack',
          type: 'checkboxes',
          label: 'Stack',
          options: ['JS', 'Python', 'Go'],
          points: { JS: 5, Go: 3 },
          showIf: { fieldId: 'years', op: 'neq', value: '0' },
        },
      ],
    },
  ],
};

test('conditional chain shows and hides fields', () => {
  assert.deepEqual(visibleFields(schema, {}).map((f) => f.id), ['exp']);
  assert.deepEqual(visibleFields(schema, { exp: 'Yes' }).map((f) => f.id), ['exp', 'years']);
  assert.deepEqual(
    visibleFields(schema, { exp: 'Yes', years: 3 }).map((f) => f.id),
    ['exp', 'years', 'stack']
  );
  // hiding the controller collapses the whole chain even with stale answers
  assert.deepEqual(
    visibleFields(schema, { exp: 'No', years: 3, stack: ['JS'] }).map((f) => f.id),
    ['exp']
  );
});

test('validation enforces required only when visible, drops hidden answers', () => {
  let r = validateAnswers(schema, {});
  assert.equal(r.errors.exp, 'This field is required');
  assert.equal(r.errors.years, undefined);

  r = validateAnswers(schema, { exp: 'Yes' });
  assert.equal(r.errors.years, 'This field is required');

  r = validateAnswers(schema, { exp: 'No', years: 99, stack: ['JS'] });
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.clean, { exp: 'No' });
});

test('validation rejects out-of-range values', () => {
  const r = validateAnswers(schema, { exp: 'Maybe' });
  assert.equal(r.errors.exp, 'Pick one of the listed options');
  const r2 = validateAnswers(schema, { exp: 'Yes', years: 'abc' });
  assert.equal(r2.errors.years, 'Enter a number');
  const r3 = validateAnswers(schema, { exp: 'Yes', years: 2, stack: ['Rust'] });
  assert.equal(r3.errors.stack, 'Pick from the listed options');
});

test('salary field validates and formats INR', () => {
  const s: FormSchema = {
    pages: [{ title: 'p', fields: [{ id: 'sal', type: 'salary', label: 'Expected CTC', required: true }] }],
  };
  assert.equal(validateAnswers(s, { sal: '4,50,000' }).clean.sal, '₹4,50,000');
  assert.equal(validateAnswers(s, { sal: 'abc' }).errors.sal, 'Enter an amount in INR');
});

test('rich text renders subset and escapes HTML', async () => {
  const { renderRich } = await import('../lib/richtext.ts');
  const html = renderRich('**bold** and *em*\n- one\n- two\n<script>alert(1)</script>');
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<em>em</em>'));
  assert.ok(html.includes('<li>one</li>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('max score sums best options; checkboxes sum positive points', () => {
  // exp: best Yes = 10; stack (checkboxes): JS 5 + Go 3 = 8
  assert.equal(computeMaxScore(schema), 18);
});

test('score sums option points on visible fields only', () => {
  assert.equal(computeScore(schema, { exp: 'Yes', years: 2, stack: ['JS', 'Go'] }), 18);
  assert.equal(computeScore(schema, { exp: 'No', stack: ['JS', 'Go'] }), 0);
  assert.equal(computeScore(schema, {}), 0);
});

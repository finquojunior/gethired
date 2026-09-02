import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadedPathRe } from '../lib/uploads.ts';

test('resume paths accepted back only in the shape createSignedUpload mints', () => {
  const re = uploadedPathRe('resumes');
  assert.ok(re.test('resumes/0123456789abcdef01234567.pdf'));
  assert.ok(!re.test('submissions/0123456789abcdef01234567.pdf'));
  assert.ok(!re.test('resumes/../briefs/0123456789abcdef01234567.pdf'));
  assert.ok(!re.test('resumes/0123456789abcdef01234567.exe'));
});

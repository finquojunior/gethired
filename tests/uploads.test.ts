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

import { taskExt } from '../lib/uploads.ts';

test('task files: anything goes except executables; odd extensions are dropped', () => {
  assert.equal(taskExt('design.fig'), '.fig');
  assert.equal(taskExt('Photo.JPG'), '.jpg');
  assert.equal(taskExt('README'), '');
  assert.equal(taskExt('weird.tar gz'), '');
  assert.equal(taskExt('virus.exe'), null);
  assert.equal(taskExt('run.SH'), null);
  const re = uploadedPathRe('submissions');
  assert.ok(re.test('submissions/0123456789abcdef01234567.fig'));
  assert.ok(re.test('submissions/0123456789abcdef01234567'));
  assert.ok(!re.test("submissions/0123456789abcdef01234567.exe"));
  assert.ok(!re.test("submissions/0123456789abcdef01234567.exe/../x"));
  assert.ok(!re.test('briefs/0123456789abcdef01234567.pdf'));
});

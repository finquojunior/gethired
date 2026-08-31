import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefLinks, composeBriefEmail, parseSubmissionFields } from '../lib/brief.ts';

test('parseSubmissionFields normalizes and rejects junk', () => {
  const out = parseSubmissionFields([
    { id: 'abc-123', title: '  Source code  ', kind: 'file', required: 1 },
    { id: '<script>', title: 'Demo', kind: 'nonsense', required: false },
    { title: '' }, // no title → dropped
    'garbage',
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'abc-123', title: 'Source code', kind: 'file', required: true });
  assert.equal(out[1].title, 'Demo');
  assert.equal(out[1].kind, 'either'); // unknown kind falls back
  assert.match(out[1].id, /^[0-9a-f-]{36}$/); // invalid id replaced with uuid
  assert.deepEqual(parseSubmissionFields('not an array'), []);
});
import { uploadedPathRe } from '../lib/uploads.ts';

test('uploadedPathRe accepts only paths shaped like our minted uploads', () => {
  assert.ok(uploadedPathRe('briefs').test('briefs/0123456789abcdef01234567.pdf'));
  assert.ok(uploadedPathRe('submissions').test('submissions/0123456789abcdef01234567.zip'));
  assert.ok(!uploadedPathRe('briefs').test('submissions/0123456789abcdef01234567.pdf'));
  assert.ok(!uploadedPathRe('briefs').test('briefs/../resumes/x.pdf'));
  assert.ok(!uploadedPathRe('briefs').test('briefs/0123456789abcdef01234567.exe'));
});

test('briefLinks keeps only http(s) lines, trimmed', () => {
  assert.deepEqual(
    briefLinks(' https://a.com \nnot a link\nhttp://b.com\n\nftp://c.com'),
    ['https://a.com', 'http://b.com']
  );
  assert.deepEqual(briefLinks(null), []);
});

test('composeBriefEmail combines whichever materials exist', () => {
  assert.equal(composeBriefEmail('', '', ''), 'Task details will follow.');
  assert.equal(composeBriefEmail('Do the thing.', '', ''), 'Do the thing.');
  assert.equal(
    composeBriefEmail('Do the thing.', 'https://spec.example.com', 'https://hire.example.com/c/tok/brief'),
    'Do the thing.\n\nReference links:\nhttps://spec.example.com\n\nTask brief document:\nhttps://hire.example.com/c/tok/brief'
  );
  // doc only: no leading blank lines
  assert.equal(
    composeBriefEmail('', '', 'https://hire.example.com/c/tok/brief'),
    'Task brief document:\nhttps://hire.example.com/c/tok/brief'
  );
});

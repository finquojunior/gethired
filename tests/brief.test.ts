import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefLinks, composeBriefEmail } from '../lib/brief.ts';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv.ts';

test('parseCsv: quoted commas, escaped quotes, embedded newline, CRLF, blank rows', () => {
  const text = 'name,note\r\n"Doe, Jane","said ""hi""\nthere"\r\n,\r\nplain,x';
  assert.deepEqual(parseCsv(text), [
    ['name', 'note'],
    ['Doe, Jane', 'said "hi"\nthere'],
    ['plain', 'x'],
  ]);
});

test('parseCsv: empty fields keep their position; trailing newline adds no row', () => {
  assert.deepEqual(parseCsv('a,,c\n'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv(''), []);
});

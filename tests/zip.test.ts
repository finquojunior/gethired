import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from '../lib/zip.ts';

test('buildZip: valid store-only archive with both entries', () => {
  const zip = buildZip([
    { name: 'a/hello.txt', data: Buffer.from('hello') },
    { name: 'b/résumé.pdf', data: Buffer.from('%PDF-1.4') },
  ]);
  // local file header for the first entry at offset 0
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
  assert.equal(zip.readUInt32LE(14), 0x3610a686); // crc32("hello")
  assert.equal(zip.readUInt32LE(18), 5); // stored size
  // end of central directory is the last 22 bytes
  const eocd = zip.length - 22;
  assert.equal(zip.subarray(eocd, eocd + 4).toString('latin1'), 'PK\x05\x06');
  assert.equal(zip.readUInt16LE(eocd + 10), 2); // total entries
  // central directory starts where the EOCD says it does
  const cdOffset = zip.readUInt32LE(eocd + 16);
  assert.equal(zip.subarray(cdOffset, cdOffset + 4).toString('latin1'), 'PK\x01\x02');
  const text = zip.toString('utf8');
  assert.ok(text.includes('a/hello.txt'));
  assert.ok(text.includes('b/résumé.pdf'));
});

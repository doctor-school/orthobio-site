import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decideUpload, magicMatches, parseUploadArgs } from '../../scripts/lib/upload-object.mjs';

/**
 * The pure decisions behind scripts/upload-media-object.mjs. The dangerous one
 * is the pre-read: only a definite «no such key» may lead to a PUT, because
 * every object is served immutable and an overwrite is invisible to caches.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const LOCAL = sha('new bytes');

describe('decideUpload', () => {
  it('uploads when the signed pre-read says 404 (key is free)', () => {
    expect(decideUpload({ status: 404, body: Buffer.from('<Error/>') }, LOCAL, false).action).toBe('upload');
  });

  it('is a no-op when the key already holds identical bytes', () => {
    expect(decideUpload({ status: 200, body: Buffer.from('new bytes') }, LOCAL, false).action).toBe('noop');
    expect(decideUpload({ status: 200, body: Buffer.from('new bytes') }, LOCAL, true).action).toBe('noop');
  });

  it('refuses different bytes without --replace, and says what is there', () => {
    const d = decideUpload({ status: 200, body: Buffer.from('old bytes') }, LOCAL, false);
    expect(d.action).toBe('refuse');
    expect(d.message).toContain(sha('old bytes'));
  });

  it('overwrites different bytes only with --replace', () => {
    expect(decideUpload({ status: 200, body: Buffer.from('old bytes') }, LOCAL, true).action).toBe('upload');
  });

  it.each([403, 500, 503, 301, 0])('aborts on HTTP %i — an unreadable key is not an empty key', (status) => {
    const d = decideUpload({ status, body: Buffer.alloc(0) }, LOCAL, true);
    expect(d.action).toBe('abort');
    expect(d.message).toContain(String(status));
  });
});

describe('parseUploadArgs', () => {
  it('takes <file> <key> and an optional --replace', () => {
    expect(parseUploadArgs(['a.webp', 'k/a.webp'])).toEqual({ file: 'a.webp', key: 'k/a.webp', replace: false });
    expect(parseUploadArgs(['--replace', 'a.webp', 'k/a.webp'])).toEqual({
      file: 'a.webp',
      key: 'k/a.webp',
      replace: true,
    });
  });

  it('rejects unknown flags instead of silently ignoring a typo', () => {
    expect(() => parseUploadArgs(['a.webp', 'k/a.webp', '--replase'])).toThrow(/--replase/);
    expect(() => parseUploadArgs(['a.webp', 'k/a.webp', '--dry-run'])).toThrow(/--dry-run/);
  });

  it('rejects a missing or an extra positional', () => {
    expect(() => parseUploadArgs(['a.webp'])).toThrow(/usage/);
    expect(() => parseUploadArgs(['a.webp', 'k/a.webp', 'extra'])).toThrow(/usage/);
  });
});

describe('magicMatches', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pdf = Buffer.from('%PDF-1.7\n....');

  it('accepts bytes that match the type the key extension implies', () => {
    expect(magicMatches(webp, 'image/webp')).toBe(true);
    expect(magicMatches(png, 'image/png')).toBe(true);
    expect(magicMatches(jpeg, 'image/jpeg')).toBe(true);
    expect(magicMatches(pdf, 'application/pdf')).toBe(true);
  });

  it('catches a file whose bytes contradict the key extension', () => {
    expect(magicMatches(jpeg, 'image/webp')).toBe(false);
    expect(magicMatches(webp, 'image/png')).toBe(false);
    expect(magicMatches(png, 'application/pdf')).toBe(false);
  });
});

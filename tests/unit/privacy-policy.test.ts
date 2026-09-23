import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The published policy text IS the consent version: the platform stamps
 * `<publication date>.sha256-<hash>` on every acceptance (044 EARS-9,
 * ADR-0009 §2.1), and the owner recorded the hash below on Issue #78. Any
 * edit — a typographer pass, an editor adding a final newline, autocrlf —
 * changes the hash and silently detaches every recorded consent from the text.
 *
 * The owner's hash is of the LF-normalised UTF-8 text WITHOUT a trailing
 * newline: the file ends right after «…/privacy.», and the same text with a
 * final `\n` digests to 69c11aee… instead. `.gitattributes` pins the file to LF
 * so a Windows checkout cannot CRLF it.
 */
const OWNER_SHA256 = '968645ba2e354b73488da4fd8aed2addf4288b531132f4861b1b9b06ec9cfb5f';
const bytes = readFileSync('src/content/legal/privacy-policy.txt');
const text = bytes.toString('utf8');

describe('privacy policy text', () => {
  it('is byte-for-byte the text whose hash the owner recorded', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(OWNER_SHA256);
  });

  it('is stored with LF line endings and no trailing newline', () => {
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(false);
  });

  it('is pinned to LF by .gitattributes', () => {
    expect(readFileSync('.gitattributes', 'utf8')).toMatch(/^src\/content\/legal\/\* text eol=lf$/m);
  });

  it('names the /privacy URL the page is published at', () => {
    expect(text).toContain('https://orthobio.ru/privacy');
  });
});

/**
 * Pure decisions behind scripts/upload-media-object.mjs, split out so they can
 * be unit-tested without a bucket (tests/unit/upload-object.test.ts).
 */
import { sha256hex } from './s3-put.mjs';

export const USAGE = 'usage: node scripts/upload-media-object.mjs <file> <key> [--replace]';

/** Throws on an unknown flag: a typo like `--replase` must not silently mean «no replace». */
export function parseUploadArgs(argv) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--replace');
  if (unknown.length) throw new Error(`unknown flag(s) ${unknown.join(' ')}; ${USAGE}`);
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length !== 2) throw new Error(USAGE);
  const [file, key] = positional;
  return { file, key, replace: flags.includes('--replace') };
}

/**
 * What to do given the owner's signed pre-read of the key.
 * Only 404 means the key is free; 200 is compared by sha256; ANY other status
 * (403, 5xx, a redirect, a network failure passed as 0) aborts — an unreadable
 * key is not an empty key, and objects here are served immutable.
 *
 * @param {{status: number, body: Buffer}} pre
 * @param {string} localSha256
 * @param {boolean} replace
 * @returns {{action: 'upload' | 'noop' | 'refuse' | 'abort', message: string}}
 */
export function decideUpload(pre, localSha256, replace) {
  if (pre.status === 404) return { action: 'upload', message: 'key is free (404)' };
  if (pre.status === 200) {
    const remote = sha256hex(pre.body);
    if (remote === localSha256) return { action: 'noop', message: 'already present with identical bytes — nothing uploaded' };
    if (replace) return { action: 'upload', message: `--replace: overwriting ${pre.body.length} B, sha256 ${remote}` };
    return {
      action: 'refuse',
      message:
        `key already holds DIFFERENT bytes (${pre.body.length} B, sha256 ${remote}); ` +
        'objects are served immutable — pick a new key, or pass --replace if you really mean it',
    };
  }
  return { action: 'abort', message: `pre-read answered HTTP ${pre.status}; cannot tell whether the key is free — nothing uploaded` };
}

/** Leading-byte signatures of the types CONTENT_TYPES can produce. */
const MAGIC = {
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/avif': (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif' || b.subarray(4, 12).toString('latin1') === 'ftypavis',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'video/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'image/svg+xml': (b) => /<svg[\s>]/.test(b.subarray(0, 1024).toString('utf8')),
};

/**
 * The served Content-Type comes from the KEY's extension; this checks the
 * FILE's bytes agree, so `photo.jpg` uploaded as `x.webp` fails before the PUT.
 */
export function magicMatches(body, contentType) {
  const check = MAGIC[contentType];
  return check ? check(body) : false;
}

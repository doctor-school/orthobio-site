/**
 * Upload ONE local file to the `orthobio-media` bucket under an explicit key,
 * then read it back and prove the bucket serves the same bytes.
 *
 *   node scripts/upload-media-object.mjs <file> <key> [--replace]
 *
 *   e.g. node scripts/upload-media-object.mjs \
 *          ~/orthobio-assets/2026/people/zagorodniy-288.webp 2026/people/zagorodniy-288.webp
 *
 * For the one-off additions (an owner-supplied portrait, a replacement PDF)
 * that do not deserve a rescue script of their own. Additive by default: an
 * object already at the key with identical bytes is a no-op, and one with
 * DIFFERENT bytes is refused unless `--replace` — every object here is served
 * `immutable` for a year, so silently overwriting one leaves browsers and the
 * nginx cache showing the old bytes anyway. Never deletes, never lists.
 *
 * The pre-read is SIGNED: anonymously this bucket answers a missing key with
 * 403, the same as a forbidden one. Only a signed 404 counts as «key is free»;
 * any other non-200 aborts before the PUT. Unknown flags are rejected, and the
 * file's magic bytes must match the type the key's extension will serve.
 *
 * Credentials: env var NAMES `TIMEWEB_S3_ENDPOINT`, `TIMEWEB_S3_BUCKET`,
 * `TIMEWEB_S3_ACCESS_KEY`, `TIMEWEB_S3_SECRET_KEY` (+ `TIMEWEB_S3_REGION`,
 * default ru-1); values come from `terraform output` (infra/terraform/README.md).
 *
 * Prints the sha256, byte count and public URL — the three things the
 * docs/assets-manifest.yaml entry and docs/assets-checksums.txt line need.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_TIMEOUT_MS,
  IMMUTABLE_CACHE_CONTROL,
  getObject,
  objectUrl,
  putObject,
  s3FromEnv,
  sha256hex,
} from './lib/s3-put.mjs';
import { decideUpload, magicMatches, parseUploadArgs } from './lib/upload-object.mjs';

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
};

/**
 * Returns the exit code rather than calling process.exit(): exiting while
 * undici still holds the PUT's socket trips a libuv assertion on Windows
 * (`!(handle->flags & UV_HANDLE_CLOSING)`) and turns a clean 1 into a crash.
 */
async function main() {
  let file, key, replace;
  try {
    ({ file, key, replace } = parseUploadArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 2;
  }
  // A leading slash or a `..` segment would sign fine and land somewhere nobody
  // meant; the site addresses objects as `/media/<key>`, so the key is relative.
  if (key.startsWith('/') || key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    console.error(`refusing key «${key}»: expected a relative path like 2026/people/<slug>-288.webp`);
    return 2;
  }
  const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()];
  if (!contentType) {
    console.error(`no content type known for «${path.extname(key)}» — extend CONTENT_TYPES deliberately`);
    return 2;
  }

  const s3 = s3FromEnv();
  const url = objectUrl(s3, key);
  const body = await readFile(file);
  const sha256 = sha256hex(body);
  if (!magicMatches(body, contentType)) {
    console.error(`${file}: bytes are not ${contentType}, which the key's extension would serve them as`);
    return 2;
  }

  /** What the bucket serves PUBLICLY at the key, or null on any non-2xx. */
  const served = async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  };

  // Signed pre-read: anonymously a missing key is 403, same as a forbidden one.
  let pre;
  try {
    const res = await getObject({ ...s3, key });
    pre = { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    console.error(`pre-read of ${key} failed: ${err instanceof Error ? err.message : err}`);
    pre = { status: 0, body: Buffer.alloc(0) };
  }
  const decision = decideUpload(pre, sha256, replace);
  if (decision.action === 'abort' || decision.action === 'refuse') {
    console.error(`${key}: ${decision.message}`);
    return 1;
  }
  if (decision.action === 'noop') {
    console.log(decision.message);
  } else {
    console.log(`${key}: ${decision.message}`);
    const res = await putObject({ ...s3, key, body, contentType, cacheControl: IMMUTABLE_CACHE_CONTROL });
    if (!res.ok) {
      console.error(`PUT ${key}: HTTP ${res.status} ${await res.text()}`);
      return 1;
    }
    console.log(`PUT ${key}: HTTP ${res.status}`);
  }

  // Read back what the bucket SERVES: a PUT that "succeeded" into a bucket whose
  // public-read flag is off leaves the page silently broken behind a green run.
  const after = await served();
  if (!after || sha256hex(after) !== sha256) {
    console.error(`GET ${url}: ${after?.length ?? 0} B, sha256 mismatch (expected ${body.length} B, ${sha256})`);
    return 1;
  }
  console.log(`verified ${url}\n  bytes  ${body.length}\n  sha256 ${sha256}\n  type   ${contentType}`);
  return 0;
}

process.exitCode = await main();

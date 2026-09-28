/**
 * Single-object PUT to the `orthobio-media` bucket, SigV4-signed by hand.
 * Shared by scripts/rescue-video-posters.mjs and scripts/upload-media-object.mjs.
 *
 * Not the AWS CLI, which the runbook uses for the one-shot archive sync: the
 * CLI on this estate is a Python entry point that Node cannot spawn portably
 * (`aws` vs `aws.cmd`), and shelling out to it would make the script's most
 * dangerous step the one that depends on a shell. A PUT of a known key is ~30
 * lines of `node:crypto` and no dependency at all.
 *
 * PUT of one explicit key, never `sync`: sync reasons about a whole prefix and
 * may decide to delete or replace, and this is live paid infra holding 2.3k
 * rescued archive objects.
 */
import { createHash, createHmac } from 'node:crypto';

export const DEFAULT_TIMEOUT_MS = 20_000;

/** Every object in this bucket is an immutable derivative (issue #5). */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/**
 * SigV4 wants RFC 3986 percent-encoding in the canonical URI, and
 * `encodeURIComponent` leaves `!*'()` alone. Today's keys need none of it, but
 * the failure mode is a signature that quietly disagrees with the server:
 * `SignatureDoesNotMatch` on a key with a bracket in it is a miserable thing to
 * diagnose.
 */
export const rfc3986 = (segment) =>
  encodeURIComponent(segment).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Path-style object URL — the same form the signature covers. */
export const objectUrl = ({ endpoint, bucket }, key) =>
  `${endpoint}/${[bucket, ...key.split('/')].map(rfc3986).join('/')}`;

/**
 * S3 settings from the env var NAMES in infra/terraform/README.md; their values
 * come from `terraform output` and live nowhere in this repo. Throws when any
 * required one is missing.
 */
export function s3FromEnv(env = process.env) {
  const s3 = {
    endpoint: env.TIMEWEB_S3_ENDPOINT,
    bucket: env.TIMEWEB_S3_BUCKET,
    region: env.TIMEWEB_S3_REGION ?? 'ru-1',
    accessKey: env.TIMEWEB_S3_ACCESS_KEY,
    secretKey: env.TIMEWEB_S3_SECRET_KEY,
  };
  if (!s3.endpoint || !s3.bucket || !s3.accessKey || !s3.secretKey) {
    throw new Error(
      'set TIMEWEB_S3_ENDPOINT, TIMEWEB_S3_BUCKET, TIMEWEB_S3_ACCESS_KEY and TIMEWEB_S3_SECRET_KEY ' +
        '— values come from `terraform output` (infra/terraform/README.md), never from this repo',
    );
  }
  return s3;
}

export async function putObject({
  endpoint,
  bucket,
  region,
  accessKey,
  secretKey,
  key,
  body,
  contentType,
  cacheControl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = new Date(),
  fetchImpl = fetch,
}) {
  const host = new URL(endpoint).host;
  const canonicalUri = `/${[bucket, ...key.split('/')].map(rfc3986).join('/')}`;
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signed = Object.keys(headers).sort();
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    `${signed.map((h) => `${h}:${headers[h]}`).join('\n')}\n`,
    signed.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = ['aws4_request'].reduce(
    (k, part) => hmac(k, part),
    [region, 's3'].reduce((k, part) => hmac(k, part), hmac(`AWS4${secretKey}`, date)),
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return fetchImpl(`${endpoint}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

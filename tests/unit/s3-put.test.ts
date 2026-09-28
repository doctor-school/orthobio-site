import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { getObject, objectUrl, putObject, rfc3986, s3FromEnv } from '../../scripts/lib/s3-put.mjs';

/**
 * The shared signer behind scripts/rescue-video-posters.mjs and
 * scripts/upload-media-object.mjs. The live bucket is the only real oracle for
 * a SigV4 signature, so these pin the request SHAPE the server checks first:
 * which URL is hit, which headers are signed, and that the payload hash is the
 * body's — a regression in any of them is a 403 on the next upload.
 */

const S3 = {
  endpoint: 'https://s3.example.test',
  bucket: 'orthobio-media',
  region: 'ru-1',
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'not-a-real-secret',
};

type Captured = { url: string; init: RequestInit & { headers: Record<string, string> } };

const capture = async (overrides: Record<string, unknown> = {}) => {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init as Captured['init'] });
    return new Response(null, { status: 200 });
  };
  await putObject({
    ...S3,
    key: '2026/people/zagorodniy-288.webp',
    body: Buffer.from('portrait bytes'),
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
    now: new Date('2026-09-28T12:34:56.789Z'),
    fetchImpl,
    ...overrides,
  });
  return calls[0]!;
};

describe('rfc3986', () => {
  it('escapes the characters encodeURIComponent leaves alone', () => {
    expect(rfc3986("a!b*c'd(e)f")).toBe('a%21b%2Ac%27d%28e%29f');
    expect(rfc3986('zagorodniy-288.webp')).toBe('zagorodniy-288.webp');
  });
});

describe('objectUrl', () => {
  it('is path-style, bucket first, each segment encoded', () => {
    expect(objectUrl(S3, '2026/people/x (1).webp')).toBe(
      'https://s3.example.test/orthobio-media/2026/people/x%20%281%29.webp',
    );
  });
});

describe('putObject', () => {
  it('PUTs to the path-style URL of the key', async () => {
    const { url, init } = await capture();
    expect(init.method).toBe('PUT');
    expect(url).toBe('https://s3.example.test/orthobio-media/2026/people/zagorodniy-288.webp');
  });

  it('signs exactly the five headers it sends, with the body hash and the request time', async () => {
    const { init } = await capture();
    const h = init.headers;
    expect(h['x-amz-content-sha256']).toBe(createHash('sha256').update('portrait bytes').digest('hex'));
    expect(h['x-amz-date']).toBe('20260928T123456Z');
    expect(h['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(h['content-type']).toBe('image/webp');
    expect(h.host).toBe('s3.example.test');
    expect(h.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260928\/ru-1\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('is deterministic for a fixed time and depends on the secret', async () => {
    const sig = (c: Captured) => c.init.headers.authorization.split('Signature=')[1];
    const a = await capture();
    const b = await capture();
    const c = await capture({ secretKey: 'another-secret' });
    expect(sig(a)).toBe(sig(b));
    expect(sig(c)).not.toBe(sig(a));
  });
});

describe('signature golden values', () => {
  // Frozen clock + fixed inputs: any change to the canonical request, the
  // string to sign or the key derivation moves these, even when the request
  // SHAPE assertions above still pass. Recorded from the signer that uploaded
  // 2026/people/zagorodniy-288.webp to the live bucket (HTTP 200).
  it('PUT', async () => {
    const { init } = await capture();
    expect(init.headers.authorization.split('Signature=')[1]).toBe('1474c9892fe7668467625b97b9c0e4d28750e882e2f58d9f29b9b32809090c7d');
  });

  it('GET', async () => {
    const calls: Captured[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init as Captured['init'] });
      return new Response(null, { status: 404 });
    };
    await getObject({ ...S3, key: '2026/people/zagorodniy-288.webp', now: new Date('2026-09-28T12:34:56.789Z'), fetchImpl });
    const { url, init } = calls[0]!;
    expect(init.method).toBe('GET');
    expect(url).toBe('https://s3.example.test/orthobio-media/2026/people/zagorodniy-288.webp');
    expect(init.headers['x-amz-content-sha256']).toBe(createHash('sha256').update('').digest('hex'));
    expect(init.headers.authorization).toMatch(/SignedHeaders=host;x-amz-content-sha256;x-amz-date, /);
    expect(init.headers.authorization.split('Signature=')[1]).toBe('cdf8e3411bbdefd99b2240befef9cb02e95211404448f20f625ee0c9418df60b');
  });
});

describe('s3FromEnv', () => {
  const full = {
    TIMEWEB_S3_ENDPOINT: 'https://s3.example.test',
    TIMEWEB_S3_BUCKET: 'orthobio-media',
    TIMEWEB_S3_ACCESS_KEY: 'ak',
    TIMEWEB_S3_SECRET_KEY: 'sk',
  };

  it('defaults the region to ru-1', () => {
    expect(s3FromEnv(full).region).toBe('ru-1');
  });

  it('names the missing variables instead of signing with undefined', () => {
    expect(() => s3FromEnv({ ...full, TIMEWEB_S3_SECRET_KEY: undefined })).toThrow(/TIMEWEB_S3_SECRET_KEY/);
  });
});

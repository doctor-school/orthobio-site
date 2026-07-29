/**
 * Rescue the poster frames of the 23 archive videos into our own bucket
 * (Issue #33).
 *
 * The click-to-load facade (PR #30) paints a dark plate where a player would
 * show the frame, because hotlinking `i.ytimg.com` / Rutube's CDN is out under
 * the media rule — the site must survive the death of any external link. So the
 * frames are fetched ONCE here, re-encoded to a card-sized WebP and uploaded to
 * `orthobio-media` under `posters/`; the content YAML then points at
 * `/media/posters/<key>` like every other asset. Nothing at render time ever
 * touches a foreign host.
 *
 *   node scripts/rescue-video-posters.mjs [--out .rescue/posters] [--upload]
 *
 * Without `--upload` the script only downloads and stages (safe to re-run
 * anywhere). With `--upload` it PUTs each derivative to S3 under a prefix of
 * its own — one explicit key at a time, NOT the AWS CLI and not `aws s3 sync`
 * (see `putObject` below for why), never a delete and never a rewrite of
 * anything else, since the bucket is live paid infra holding 2.3k rescued
 * archive objects. An object already in the bucket with the right bytes is
 * left alone, so a second `--upload` run is a no-op. Credentials come from the
 * env var NAMES in infra/terraform/README.md (`TIMEWEB_S3_ENDPOINT`,
 * `TIMEWEB_S3_BUCKET`, `TIMEWEB_S3_ACCESS_KEY`, `TIMEWEB_S3_SECRET_KEY`);
 * their values come from `terraform output` and live nowhere in this repo.
 *
 * Output: <out>/src/<id>.jpg (untouched source frames), <out>/web/<id>.webp
 * (what the bucket gets) and <out>/index.json — provenance, sha256 and pixel
 * dimensions, which is what the `video_posters:` section of
 * docs/assets-manifest.yaml and the `poster:` blocks in
 * src/content/congress/*.yaml are written from.
 */
import { createHash, createHmac } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { parse } from 'yaml';

const CONGRESS_DIR = path.resolve('src/content/congress');

const outDir = (() => {
  const i = process.argv.indexOf('--out');
  // `?? DEFAULT` and not `argv[i + 1]`: a trailing `--out` with no value would
  // otherwise reach path.resolve(undefined) and die on ERR_INVALID_ARG_TYPE.
  return path.resolve(i === -1 ? '.rescue/posters' : (process.argv[i + 1] ?? '.rescue/posters'));
})();
const doUpload = process.argv.includes('--upload');

/**
 * Card-slot width ×2. The video grid's column floor is 300px and a card is at
 * most ~390px wide (1200px container, three tracks), so 800px covers the
 * densest phone at a shade over 2x. `withoutEnlargement` keeps a small source
 * small — a 480px frame upscaled to 800 is the same pixels, just heavier.
 */
const TARGET_WIDTH = 800;
const ASPECT = 16 / 9;

/**
 * YouTube's thumbnail ladder, best first. `maxresdefault` exists only for
 * videos uploaded in HD (the 2021 reports are not), and a missing rung answers
 * 404 with a 1.1 KB grey placeholder — so the STATUS decides, never the body.
 *
 * The bottom two rungs are 4:3 boxes with the 16:9 frame letterboxed inside,
 * which is why every source is centre-cropped to 16:9 below: the crop is what
 * removes the black bars, not a cosmetic choice.
 */
const YT_RUNGS = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'];

const RUTUBE_ID = /^[0-9a-f]{32}$/i;

const TIMEOUT_MS = 20_000;
const get = (url) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

/** `<provider>-<video id>` — a poster is keyed by the VIDEO, not by the year. */
const posterId = (url) => {
  const u = URL.parse(url);
  if (!u) return null;
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1);
    return id ? { provider: 'youtube', id, key: `yt-${id}` } : null;
  }
  if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
    const id = u.searchParams.get('v');
    return id ? { provider: 'youtube', id, key: `yt-${id}` } : null;
  }
  if (u.hostname === 'rutube.ru') {
    const seg = u.pathname.split('/').filter(Boolean);
    const id = seg[0] === 'video' ? (seg[1] === 'private' ? seg[2] : seg[1]) : undefined;
    return id && RUTUBE_ID.test(id) ? { provider: 'rutube', id, key: `rt-${id}` } : null;
  }
  return null;
};

/** Best available source frame, or `null` when the provider publishes none. */
async function sourceFrame({ provider, id }) {
  if (provider === 'youtube') {
    for (const rung of YT_RUNGS) {
      const url = `https://i.ytimg.com/vi/${id}/${rung}.jpg`;
      const res = await get(url);
      if (res.ok) return { url, buf: Buffer.from(await res.arrayBuffer()), variant: rung };
    }
    return null;
  }
  // Rutube publishes no predictable thumbnail path; the public video API is the
  // only way to learn where the frame lives.
  const api = `https://rutube.ru/api/video/${id}/`;
  const meta = await get(api);
  if (!meta.ok) return null;
  const { thumbnail_url: url } = await meta.json();
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  const res = await get(url);
  if (!res.ok) return null;
  return { url, buf: Buffer.from(await res.arrayBuffer()), variant: 'api/thumbnail_url' };
}

/**
 * The letterbox assumption is CHECKED, not trusted: a 4:3 source whose bars are
 * not black is a genuinely 4:3 frame, and the centre crop then eats the top and
 * bottom of real content. Reported, never enforced — a bright band is a reason
 * for a human to look at that one poster, not to fail a 23-video run.
 */
async function looksLetterboxed(image, width, height) {
  const band = Math.max(1, Math.round(height * 0.06));
  const { channels } = await sharp(await image.clone().extract({ left: 0, top: 0, width, height: band }).toBuffer()).stats();
  const mean = channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
  return mean < 40; // 0-255; the bars are near-black, real footage rarely is
}

const videos = [];
for (const file of (await readdir(CONGRESS_DIR)).filter((f) => f.endsWith('.yaml'))) {
  const data = parse(await readFile(path.join(CONGRESS_DIR, file), 'utf8'));
  // `2099.yaml` is the draft smoke fixture: its «video» is an invented S3 path,
  // and posterId() returns null for it anyway.
  if (data.draft === true) continue;
  for (const v of data.videos ?? []) videos.push({ year: data.year, url: v.url, title: v.title ?? null });
}

await mkdir(path.join(outDir, 'src'), { recursive: true });
await mkdir(path.join(outDir, 'web'), { recursive: true });

const index = [];
const missing = [];
const suspect = [];

for (const video of videos) {
  const ident = posterId(video.url);
  if (!ident) {
    missing.push(`${video.year} ${video.url}: no video id could be derived`);
    continue;
  }
  /*
   * One object per video even if two years cite the same upload. Keyed off
   * `index`, not a separate `seen` set: a set marked BEFORE the download can
   * disagree with what was actually staged, and the second sighting of a video
   * whose frame failed would then look up an entry that does not exist.
   */
  const already = index.find((e) => e.key === ident.key);
  if (already) {
    already.years.push(video.year);
    continue;
  }

  /*
   * One video's failure is one line of the report, never the end of the run.
   * A 20s timeout on the fourteenth item, or an HTTP 200 carrying HTML where a
   * JPEG was promised (sharp: «Input buffer contains unsupported image
   * format»), used to reject out of the loop — losing `index.json` for the
   * objects that HAD been staged. The catch gives a network hiccup the same
   * shape as the «provider publishes no frame» branch it sits next to.
   */
  try {
    const frame = await sourceFrame(ident);
    if (!frame) {
      missing.push(`${video.year} ${ident.key}: ${ident.provider} publishes no poster frame`);
      continue;
    }

    const srcFile = `src/${ident.key}.jpg`;
    await writeFile(path.join(outDir, srcFile), frame.buf);

    const image = sharp(frame.buf);
    const meta = await image.metadata();
    if (Math.abs(meta.width / meta.height - ASPECT) > 0.02 && !(await looksLetterboxed(image, meta.width, meta.height))) {
      suspect.push(`${ident.key}: ${meta.width}×${meta.height} source with a bright top band — the 16:9 crop may cut content`);
    }

    /*
     * Crop THEN resize, as two explicit steps. `fit: 'cover'` with
     * `withoutEnlargement` does neither on a small source — it silently returns
     * the 480×360 letterboxed original, bars and all, at an aspect ratio the
     * card does not have. Cropping first makes 16:9 unconditional and leaves
     * the downscale free to stop at the source's own width.
     */
    const cropW = Math.min(meta.width, Math.round(meta.height * ASPECT));
    const cropH = Math.round(cropW / ASPECT);
    const outW = Math.min(TARGET_WIDTH, cropW);
    const buf = await sharp(frame.buf)
      // Centred, never an entropy crop: these sources are letterboxed, and
      // «attention» would chase the bright half of the frame off-centre.
      .extract({
        left: Math.round((meta.width - cropW) / 2),
        top: Math.round((meta.height - cropH) / 2),
        width: cropW,
        height: cropH,
      })
      .resize({ width: outW, height: Math.round(outW / ASPECT), fit: 'fill' })
      .webp({ quality: 78, effort: 6 })
      .toBuffer();
    const web = await sharp(buf).metadata();
    await writeFile(path.join(outDir, `web/${ident.key}.webp`), buf);

    index.push({
      key: ident.key,
      provider: ident.provider,
      video_id: ident.id,
      video_url: video.url,
      title: video.title,
      years: [video.year],
      source_url: frame.url,
      source_variant: frame.variant,
      src_file: srcFile,
      original: { w: meta.width, h: meta.height, bytes: frame.buf.length },
      object: {
        file: `web/${ident.key}.webp`,
        s3_key: `posters/${ident.key}.webp`,
        w: web.width,
        h: web.height,
        bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
      },
    });
    console.log(`${ident.key}: ${frame.variant} ${meta.width}×${meta.height} → ${web.width}×${web.height} webp, ${buf.length} B`);
  } catch (error) {
    missing.push(`${video.year} ${ident.key}: ${error instanceof Error ? error.message : error}`);
  }
}

await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`\n${index.length}/${videos.length} posters staged in ${outDir}`);

/**
 * Single-object PUT, SigV4-signed by hand.
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
const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/**
 * SigV4 wants RFC 3986 percent-encoding in the canonical URI, and
 * `encodeURIComponent` leaves `!*'()` alone. Today's keys are
 * `posters/(yt|rt)-<id>.webp` — YouTube ids are `[A-Za-z0-9_-]`, Rutube ids are
 * hex — so nothing here needs it. It is written down anyway because the failure
 * mode is a signature that quietly disagrees with the server: `SignatureDoes
 * NotMatch` on a key with a bracket in it is a miserable thing to diagnose.
 */
const rfc3986 = (segment) =>
  encodeURIComponent(segment).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function putObject({ endpoint, bucket, region, accessKey, secretKey, key, body, contentType, cacheControl }) {
  const host = new URL(endpoint).host;
  const canonicalUri = `/${[bucket, ...key.split('/')].map(rfc3986).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
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

  return fetch(`${endpoint}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

if (doUpload) {
  const s3 = {
    endpoint: process.env.TIMEWEB_S3_ENDPOINT,
    bucket: process.env.TIMEWEB_S3_BUCKET,
    region: process.env.TIMEWEB_S3_REGION ?? 'ru-1',
    accessKey: process.env.TIMEWEB_S3_ACCESS_KEY,
    secretKey: process.env.TIMEWEB_S3_SECRET_KEY,
  };
  if (!s3.endpoint || !s3.bucket || !s3.accessKey || !s3.secretKey) {
    throw new Error(
      'set TIMEWEB_S3_ENDPOINT, TIMEWEB_S3_BUCKET, TIMEWEB_S3_ACCESS_KEY and TIMEWEB_S3_SECRET_KEY ' +
        '— values come from `terraform output` (infra/terraform/README.md), never from this repo',
    );
  }

  /** What the bucket already serves at this key, or null. */
  const fetched = async (entry) => {
    const res = await get(`${s3.endpoint}/${s3.bucket}/${entry.object.s3_key}`);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  };

  const failures = [];
  let uploaded = 0;
  let skipped = 0;
  for (const entry of index) {
    try {
      const body = await readFile(path.join(outDir, entry.object.file));
      // A re-run must cost the bucket nothing. Compared by CONTENT, not by
      // presence: the key is derived from the video id, so an object that is
      // there but different means the encoder changed under us (a sharp/libwebp
      // upgrade re-encodes the same frame to different bytes) and the manifest
      // sha256 has to be refreshed with it.
      if (sha256hex((await fetched(entry)) ?? Buffer.alloc(0)) === entry.object.sha256) {
        skipped++;
        continue;
      }
      const res = await putObject({
        ...s3,
        key: entry.object.s3_key,
        body,
        contentType: 'image/webp',
        // Immutable derivative, like every other object in this bucket (issue #5).
        cacheControl: 'public, max-age=31536000, immutable',
      });
      if (!res.ok) failures.push(`PUT ${entry.object.s3_key}: HTTP ${res.status} ${await res.text()}`);
      else uploaded++;
    } catch (error) {
      // Collected, not thrown: a failure on the twentieth object must not cost
      // us the read-back of the nineteen already in the bucket — that report is
      // the whole reason this block exists, and it is needed most exactly when
      // something went wrong.
      failures.push(`PUT ${entry.object.s3_key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Read back what the bucket actually SERVES, for every object, including the
  // ones this run skipped. A PUT that "succeeded" against a wrong key, or into
  // a bucket whose public-read flag is off, leaves 23 cards silently broken
  // behind a green run.
  let verified = 0;
  for (const entry of index) {
    try {
      const body = await fetched(entry);
      if (body && sha256hex(body) === entry.object.sha256) verified++;
      else failures.push(`GET ${entry.object.s3_key}: ${body?.length ?? 0} B, sha256 mismatch (expected ${entry.object.bytes} B)`);
    } catch (error) {
      failures.push(`GET ${entry.object.s3_key}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(
    `verified ${verified}/${index.length} objects at ${s3.endpoint}/${s3.bucket}/posters/ ` +
      `(${uploaded} uploaded, ${skipped} already present with identical bytes)`,
  );
  if (failures.length) {
    console.error(`\n${failures.length} upload problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  if (verified !== index.length || failures.length) process.exitCode = 1;
}

if (suspect.length) {
  console.warn(`\n${suspect.length} poster(s) whose crop is worth a look:`);
  for (const s of suspect) console.warn(`  - ${s}`);
}
if (missing.length) {
  console.error(`\n${missing.length} video(s) with no poster — leave \`poster: null\` for these:`);
  for (const m of missing) console.error(`  - ${m}`);
  process.exitCode = 1;
}

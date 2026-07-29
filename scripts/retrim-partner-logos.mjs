/**
 * Re-derive the partner-logo objects so the MARK fills the card slot
 * (Issue #39).
 *
 * The problem this fixes is geometry, not colour. `rescue-partner-logos.mjs`
 * (Issue #22) only downscaled each source to a 240px long side, so whatever
 * empty field the source baked in survived into the object: the congress-ph
 * marks are 512×512 tiles with the logo floating in the middle of the old
 * site's lime (#B9CE37) field, the five orthobio.ru/orgs organizer marks are
 * 512×512 tiles with the same float on white, and the creatium соорганизатор
 * marks are 286×120 letterboxes with a crest in the middle of white.
 * PartnerTier paints those into a 120×72 `object-fit: contain` slot, and
 * `contain` scales the WHOLE frame — so «Берлин-Хеми», a 414px wordmark inside
 * a 512px tile, was drawn 58px wide inside a 120px slot. The fix is to crop the
 * field down to the mark and keep only a uniform margin.
 *
 * What is deliberately NOT done: chroma-key. The lime field is the operator's
 * house style for the partner grid (Issue #39, owner ruling 2026-07-29) — every
 * commercial mark carries it and the tier reads as one set. Cropping keeps it,
 * just less of it. Backgrounds are never recoloured here; the margin is grown
 * by replicating the frame's own edge pixels (`extendWith: 'copy'`), so a flat
 * lime field stays flat lime and the info-partner tiles keep their vertical
 * lime gradient.
 *
 *   node scripts/retrim-partner-logos.mjs [--work .rescue/logos-retrim] [--pad 0.08]
 *
 * Source of truth is `docs/assets-manifest.yaml` → `logos:`: the script fetches
 * each item's `source_url` again and REFUSES to run unless the bytes and pixel
 * dimensions still match the `original:` block recorded in Issue #22. That is
 * what makes the re-derivation provably the same provenance rather than
 * whatever those URLs serve today.
 *
 * Output: <work>/original/<file> (the verified sources), <work>/object/<file>
 * (the new objects) and <work>/index.json — `{ tool, pad_ratio, items }`, where
 * `items` carries bytes / sha256 / w / h per object (what the `object:` blocks
 * in the manifest are rewritten from) and `tool` is the sharp/libvips build
 * that produced those bytes (what the manifest's `tool:` field records, since
 * the sha256 pins are only reproducible on the same codec build).
 *
 * Uploading is NOT part of this script, matching rescue-partner-logos.mjs: the
 * bucket is live paid infra, so the sync is a separate reviewed step (see
 * infra/terraform/README.md → «Uploading the archive»).
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { parse } from 'yaml';

const MANIFEST = 'docs/assets-manifest.yaml';
const LONG_SIDE = 240; // unchanged from Issue #22 — this pass moves the crop, not the budget

/**
 * The mark is what differs from the frame's BACKGROUND, and «background» here
 * has to cover two shapes: the flat lime of the exhibitor tiles and the
 * vertical lime→green gradient of the info-partner tiles. So the background is
 * modelled as an affine plane a + b·x + c·y per channel, fitted by least
 * squares on the border ring; a flat field is just the degenerate case with
 * b = c = 0. Fitting a flat colour instead (what `sharp().trim()` does — it
 * takes the top-left pixel) reported «no margins at all» on all nine gradient
 * tiles, because the far corner is 40 levels away from the near one.
 */
const THRESHOLD = 20; // per-channel residual, 0–255. JPEG ringing sits near 8.
const MIN_RUN = 2; // ignore a row/column touched by a single stray pixel

async function analyse(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const at = (x, y, c) => data[(y * w + x) * ch + c];
  const R = Math.max(2, Math.round(0.02 * Math.min(w, h)));

  const ring = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (x < R || y < R || x >= w - R || y >= h - R) ring.push([x, y]);
  }

  /** Least squares for [a, b, c] of a + b·x + c·y over `pts`, one channel. */
  const fit = (pts, c) => {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sv = 0, sxv = 0, syv = 0;
    for (const [x, y] of pts) {
      const v = at(x, y, c);
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
      sv += v; sxv += x * v; syv += y * v;
    }
    const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
    const B = [sv, sxv, syv];
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]];
      [B[i], B[p]] = [B[p], B[i]];
      if (Math.abs(A[i][i]) < 1e-9) return [sv / n, 0, 0];
      for (let k = i + 1; k < 3; k++) {
        const f = A[k][i] / A[i][i];
        for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
        B[k] -= f * B[i];
      }
    }
    const s = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      let t = B[i];
      for (let j = i + 1; j < 3; j++) t -= A[i][j] * s[j];
      s[i] = t / A[i][i];
    }
    return s;
  };

  let coef = [0, 1, 2].map((c) => fit(ring, c));
  const resid = (x, y) => {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(at(x, y, c) - (coef[c][0] + coef[c][1] * x + coef[c][2] * y)));
    return m;
  };
  // Refit on the ring pixels the first pass already explains, so a mark that
  // bleeds into the ring (vmeda's crown touches the top edge) cannot drag the
  // plane towards itself.
  const clean = ring.filter(([x, y]) => resid(x, y) <= THRESHOLD);
  if (clean.length > ring.length * 0.5) coef = [0, 1, 2].map((c) => fit(clean, c));

  const alphaBg = at(0, 0, 3) < 16;
  const content = (x, y) => (alphaBg ? at(x, y, 3) > 16 : at(x, y, 3) > 16 && resid(x, y) > THRESHOLD);

  const rows = new Int32Array(h);
  const cols = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (content(x, y)) { rows[y]++; cols[x]++; }
  }
  const span = (arr) => {
    let a = -1, b = -1;
    for (let i = 0; i < arr.length; i++) if (arr[i] >= MIN_RUN) { if (a < 0) a = i; b = i; }
    return [a, b];
  };
  const [y0, y1] = span(rows);
  const [x0, x1] = span(cols);
  if (x1 < 0 || y1 < 0) throw new Error('no content found — the whole frame reads as background');
  const bg = [0, 1, 2].map((c) => Math.round(coef[c][0] + coef[c][1] * (w / 2) + coef[c][2] * (h / 2)));
  return { w, h, x0, y0, x1, y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1, bg, alphaBg };
}

/** Long side of the mark as PartnerTier actually paints it, in CSS px. */
const SLOT = { w: 120, h: 72 };
const rendered = ({ w, h, bw, bh }) => {
  const k = Math.min(SLOT.w / w, SLOT.h / h);
  return Math.max(bw * k, bh * k);
};

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const work = path.resolve(argOf('work', '.rescue/logos-retrim'));
const padArg = argOf('pad', '0.08');
const PAD_RATIO = Number(padArg);
// Without this, `--pad abc` sends NaN into extract/extend and dies inside sharp
// with an error that names neither the flag nor the value.
if (!Number.isFinite(PAD_RATIO) || PAD_RATIO < 0) {
  console.error(`--pad expects a finite non-negative number, got «${padArg}»`);
  process.exit(2);
}

const manifest = parse(await readFile(MANIFEST, 'utf8'));
const items = manifest.logos.items;

/**
 * Scope: ALL 49 items, with no source-based and no colour-based exclusion.
 *
 * It used to be «every mark on the old site's lime field, plus the creatium
 * 2025 соорганизатор scans», with the five 512×512 organizer marks from
 * orthobio.ru/orgs held back — the issue as originally written said «do not
 * touch the white/transparent objects». That sentence belonged to the issue's
 * first shape, where the work was chroma-keying the lime away and a white mark
 * had nothing to key. After the owner's ruling of 2026-07-29 the lime stays and
 * the only remaining complaint is that the marks are too small; leaving those
 * five out would leave the «Организаторы» tier — the first block on
 * /archive/2026 — as the single place where they still are (mapo fills 89% of a
 * square frame painted into a 120×72 slot, cito 71%, orto and ator 69%).
 *
 * The rule is written here once instead of being inferred from `isWhite(bg)`:
 * a colour test decides by symptom, so a future white-field mark from any other
 * source would have dropped out of the pass silently AND been reported with a
 * reason («outside this issue's scope») that was never true of it.
 *
 * With the scope rule gone, the only thing that can keep an object untouched is
 * the MEASUREMENT below — if the crop does not make the mark bigger in the
 * slot, the object is left byte for byte. That is what keeps `vmeda.jpg` as it
 * is even though the issue's hand-written list names it as a scan with white
 * margins: it has none, its crest runs off the top edge.
 */
const isWhite = (bg) => bg.every((v) => v > 238); // reporting only — the `field` column

await mkdir(path.join(work, 'original'), { recursive: true });
await mkdir(path.join(work, 'object'), { recursive: true });

const rows = [];
const untouched = [];
const problems = [];

for (const item of items) {
  const file = item.s3_key.replace(/^logos\//, '');
  const orig = path.join(work, 'original', file);

  // Fetch once, then reuse the staged copy on re-runs.
  let buf;
  try {
    await stat(orig);
    buf = await readFile(orig);
  } catch {
    const res = await fetch(item.source_url);
    if (!res.ok) { problems.push(`${file}: HTTP ${res.status} for ${item.source_url}`); continue; }
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(orig, buf);
  }

  const meta = await sharp(buf).metadata();
  if (meta.width !== item.original.w || meta.height !== item.original.h || buf.length !== item.original.bytes) {
    problems.push(
      `${file}: source drifted — got ${meta.width}×${meta.height} ${buf.length} B, ` +
      `manifest records ${item.original.w}×${item.original.h} ${item.original.bytes} B`,
    );
    continue;
  }

  const a = await analyse(orig);
  /*
   * «Before» is measured on the ORIGINAL frame — the `original:` block of the
   * manifest, already verified byte-identical a few lines up — and never on the
   * current object. The object is what this script rewrites: after one pass it
   * is already cropped, so scaling the source bbox by `item.object.w / a.w`
   * would describe a frame that no longer exists, and the ×1.02 guard below
   * would be comparing this run against its own previous output.
   *
   * Nothing is lost by measuring on the original instead: `rendered()` is
   * scale-invariant — max(bw, bh) · min(120/w, 72/h) is unchanged when w, h, bw
   * and bh are all scaled by the same factor — so the original's geometry gives
   * exactly the size the untrimmed mark had in the slot, which is the honest
   * «before». Every re-run therefore reaches the same verdict from the same
   * numbers, whatever state the manifest's `object:` blocks are in.
   */
  const before = { w: item.original.w, h: item.original.h, bw: a.bw, bh: a.bh };

  // A uniform ring of PAD_RATIO × the mark's long side. Where the source has
  // less field than that on some side, the shortfall is added by replicating
  // the edge — so the ring is the same width on all four sides of every mark
  // instead of «whatever that particular scan happened to leave».
  const pad = Math.max(1, Math.round(PAD_RATIO * Math.max(a.bw, a.bh)));
  const left = a.x0 - pad, top = a.y0 - pad;
  const right = a.x1 + pad, bottom = a.y1 + pad;
  const crop = {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.min(a.w, right + 1) - Math.max(0, left),
    height: Math.min(a.h, bottom + 1) - Math.max(0, top),
  };
  const extend = {
    left: Math.max(0, -left),
    top: Math.max(0, -top),
    right: Math.max(0, right - (a.w - 1)),
    bottom: Math.max(0, bottom - (a.h - 1)),
    extendWith: 'copy',
  };

  // Two passes on purpose: sharp always applies `extend` AFTER `resize`, so
  // chaining extract → extend → resize would have padded the already-scaled
  // image by a source-scale margin (vmeda came out 432×484 from a 240px
  // budget). The intermediate is PNG so a .jpg source is not re-encoded twice.
  let staged = sharp(orig).extract(crop);
  if (extend.left || extend.top || extend.right || extend.bottom) staged = staged.extend(extend);
  const canvas = await staged.png({ compressionLevel: 0 }).toBuffer();

  const pipe = sharp(canvas).resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true });
  const out =
    item.s3_key.endsWith('.jpg')
      ? await pipe.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      : await pipe.png({ compressionLevel: 9, palette: true, effort: 10 }).toBuffer();

  const om = await sharp(out).metadata();
  const canvasW = a.bw + pad * 2;
  const canvasH = a.bh + pad * 2;
  const after = {
    w: om.width,
    h: om.height,
    bw: (a.bw / canvasW) * om.width,
    bh: (a.bh / canvasH) * om.height,
  };
  const markBefore = rendered(before);
  const markAfter = rendered(after);

  /*
   * A mark that already fills its frame has nothing to win, and adding the
   * uniform ring to it would make it SMALLER on the card. `vmeda.jpg` — named
   * in the issue as an institutional scan with white margins — is exactly this
   * case: its crest runs off the top edge of a 1200×1530 scan. Measuring
   * instead of trusting the list keeps the object untouched.
   */
  if (markAfter < markBefore * 1.02) {
    untouched.push({ file, a, reason: `mark already fills the frame (${Math.round(markBefore)}px in slot; re-crop would give ${Math.round(markAfter)}px)` });
    continue;
  }

  await writeFile(path.join(work, 'object', file), out);
  rows.push({
    id: item.id,
    s3_key: item.s3_key,
    file,
    bg: a.bg,
    field: isWhite(a.bg) ? 'white' : 'lime',
    source: { w: a.w, h: a.h, bbox: `${a.bw}×${a.bh}`, pad },
    was: { w: item.object.w, h: item.object.h, bytes: item.object.bytes, sha256: item.object.sha256 },
    object: { w: om.width, h: om.height, bytes: out.length, sha256: createHash('sha256').update(out).digest('hex') },
    mark_px: { before: Math.round(markBefore), after: Math.round(markAfter) },
  });
}

/*
 * The encoder identifies itself. `object.sha256` in the manifest pins exact
 * bytes, and those bytes are only reproducible on the same codec build — a
 * later libvips will re-encode the same pixels differently and the pins will
 * look violated when nothing is wrong. This line is what the manifest's `tool:`
 * field is copied from, so «who produced these bytes» stays answerable.
 */
const tool = `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips} (mozjpeg ${sharp.versions.mozjpeg}, libpng ${sharp.versions.png})`;
await writeFile(path.join(work, 'index.json'), `${JSON.stringify({ tool, pad_ratio: PAD_RATIO, items: rows }, null, 2)}\n`);

const pad2 = (s, n) => String(s).padEnd(n);
console.log(`\n${rows.length} object(s) re-derived into ${path.join(work, 'object')}  (pad ratio ${PAD_RATIO})`);
console.log(`encoder: ${tool}\n`);
console.log(`${pad2('object', 30)}${pad2('field', 7)}${pad2('source bbox', 14)}${pad2('was', 10)}${pad2('now', 10)}${pad2('bytes', 16)}mark in slot`);
for (const r of rows.sort((a, b) => a.mark_px.after / a.mark_px.before - b.mark_px.after / b.mark_px.before)) {
  const ratio = r.mark_px.after / r.mark_px.before;
  console.log(
    pad2(r.file, 30) + pad2(r.field, 7) + pad2(r.source.bbox, 14) +
    pad2(`${r.was.w}×${r.was.h}`, 10) + pad2(`${r.object.w}×${r.object.h}`, 10) +
    pad2(`${r.was.bytes}→${r.object.bytes}`, 16) +
    `${r.mark_px.before}px → ${r.mark_px.after}px  ×${ratio.toFixed(2)}`,
  );
}

if (untouched.length) {
  console.log(`\n${untouched.length} object(s) left byte-for-byte as they are:`);
  for (const o of untouched) console.log(`  - ${pad2(o.file, 30)} ${o.reason}`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
}

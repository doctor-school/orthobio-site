/**
 * Rescue partner PROFILE pages from the old congress site (Issue #24).
 *
 * The 2026 site (the operator's congress-ph platform) gives every exhibitor a
 * page at `orthobio.ru/company?i=<slug>`: legal name, postal address, phones,
 * email, site, a self-written description, and — for some — poster images.
 * That is the content Issue #24 brings across; the pages die with the
 * operator's platform, so they are crawled, not linked.
 *
 * Why Playwright and not fetch: the catalogue at /exhibition renders its cards
 * (and therefore the `?i=` links) from JS — a plain-HTML pass sees none of
 * them, which is why the 2026 recon recorded the profile URLs only as a
 * pattern (docs/recon/orthobio-ru-main.md). The company pages themselves are
 * server-rendered, but the enumeration is not.
 *
 * The script CRAWLS + DOWNLOADS only. Uploading to S3 and writing the content
 * YAML are separate, deliberately manual steps (same split as
 * `rescue-partner-logos.mjs`, Issue #22): they touch live paid infra and
 * reviewed content.
 *
 *   node scripts/rescue-partner-profiles.mjs [--out .rescue/profiles]
 *
 * Output: <out>/index.json (one record per company: fields + provenance),
 * <out>/posters/<slug>-<n>.<ext> and web derivatives under <out>/web/, which
 * is what the manifest entries and the S3 upload are written from.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';
import sharp from 'sharp';

/** The catalogue page. Its cards are the ONLY index of the profile pages. */
const CATALOGUE = 'https://orthobio.ru/exhibition';
const ORIGIN = 'https://orthobio.ru';

const outDir = (() => {
  const i = process.argv.indexOf('--out');
  return path.resolve(i === -1 ? '.rescue/profiles' : process.argv[i + 1]);
})();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
const page = await ctx.newPage();

/* ── 1. Enumerate ──────────────────────────────────────────────────────────
 * Every «Подробнее…» link on the catalogue. Read off the LIVE DOM rather than
 * from a hand-written list, so a company added to the 2026 catalogue after
 * this run cannot be silently missed.
 */
await page.goto(CATALOGUE, { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(2000);
const hrefs = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="company?i="]')].map((a) => a.href),
);
const slugs = [...new Set(hrefs.map((h) => new URL(h).searchParams.get('i')))].filter(Boolean);
console.log(`catalogue ${CATALOGUE} -> ${slugs.length} company profiles`);

/* ── 2. Capture ────────────────────────────────────────────────────────────
 * The platform's markup is stable and semantic enough to read directly:
 *   .company-information h1        legal / trade name
 *   .contacts a.email|.tel|.site   the operator's own structured contact row
 *   .text                          the exhibitor's free-text block
 *   [id^="ModalPoster"] img        poster images (inside hidden modals)
 *
 * `.text` is captured as an ARRAY OF LINES, not one blob: the address and the
 * phone/fax lines are separate <p>/<br> lines above the prose, and keeping the
 * line boundary is what lets the address be told from the description
 * downstream without re-parsing a wall of text.
 */
const records = [];
const problems = [];

for (const slug of slugs) {
  const url = `${ORIGIN}/company?i=${slug}`;
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res?.ok()) {
    problems.push(`${slug}: HTTP ${res?.status()} for ${url}`);
    continue;
  }
  await page.waitForTimeout(400);

  const data = await page.evaluate(() => {
    const root = document.querySelector('.company-information');
    if (!root) return null;
    // The platform pads its cells with runs of &nbsp;. Collapsed to ordinary
    // spaces here so the captured text is clean plain text — RU typography is
    // re-applied later by prose() at the schema boundary (AGENTS.md).
    const clean = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const txt = (el) => clean(el?.textContent);

    // <br> is a line break inside one <p> on these pages (the address is
    // «индекс, город<br>улица, дом»), so it must become a line boundary too —
    // otherwise the two halves of an address arrive glued together. Walked as
    // DOM nodes rather than through an innerHTML round-trip: this is a
    // third-party page and its markup only ever needs reading, not re-parsing.
    const block = root.querySelector('.text');
    const lines = [];
    if (block) {
      for (const p of block.querySelectorAll('p')) {
        let buf = '';
        const flush = () => {
          const s = clean(buf);
          if (s) lines.push(s);
          buf = '';
        };
        const walk = (node) => {
          for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) buf += child.nodeValue ?? '';
            else if (child.nodeName === 'BR') flush();
            else walk(child);
          }
        };
        walk(p);
        flush();
      }
    }

    const link = (sel) => {
      const a = root.querySelector(`.contacts a.${sel}`);
      return a ? { text: txt(a), href: a.getAttribute('href') } : null;
    };

    const posters = [...document.querySelectorAll('[id^="ModalPoster"] img')]
      .map((i) => i.getAttribute('src'))
      .filter((s) => s && s.startsWith('http'));

    return {
      name: txt(root.querySelector('h1')),
      email: link('email'),
      tel: link('tel'),
      site: link('site'),
      lines,
      posters: [...new Set(posters)],
      video: document.querySelector('#ModalVideo source')?.getAttribute('src') ?? null,
    };
  });

  if (!data) {
    problems.push(`${slug}: no .company-information block at ${url}`);
    continue;
  }
  records.push({ slug, source_url: url, ...data });
  console.log(
    `captured ${slug} - "${data.name}" | ${data.lines.length} lines | ${data.posters.length} poster(s)${data.video ? ' | video' : ''}`,
  );
}

/* ── 3. Download posters ───────────────────────────────────────────────────
 * Poster JPEGs are the only binaries on these pages. Fetched through the
 * browser context so they carry the same session/referer as the page that
 * showed them.
 */
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const posterDir = path.join(outDir, 'posters');
await mkdir(posterDir, { recursive: true });

for (const rec of records) {
  rec.poster_files = [];
  for (const [i, src] of rec.posters.entries()) {
    const res = await ctx.request.get(src);
    if (!res.ok()) {
      problems.push(`${rec.slug}: HTTP ${res.status()} for poster ${src}`);
      continue;
    }
    const body = await res.body();
    const mime = (res.headers()['content-type'] ?? '').split(';')[0].trim();
    const ext = EXT_BY_MIME[mime];
    if (!ext) {
      problems.push(`${rec.slug}: unexpected poster content-type ${mime} (${src})`);
      continue;
    }
    const meta = await sharp(body).metadata();
    const file = `${rec.slug}-${i + 1}.${ext}`;
    await writeFile(path.join(posterDir, file), body);
    rec.poster_files.push({
      file: `posters/${file}`,
      source_url: src,
      content_type: mime,
      bytes: body.length,
      width: meta.width,
      height: meta.height,
      sha256: createHash('sha256').update(body).digest('hex'),
    });
    console.log(`saved ${file} (${meta.width}x${meta.height}, ${body.length} B)`);
  }
}

await browser.close();

/*
 * Web derivatives. The platform serves posters at print size for a slot that
 * is at most a page-width figure. Same policy as the logo rescue: resize +
 * re-encode only, no recolouring.
 */
const LONG_SIDE = 1200;
const webDir = path.join(outDir, 'web');
await mkdir(webDir, { recursive: true });

for (const rec of records) {
  for (const p of rec.poster_files) {
    const buf = await sharp(path.join(outDir, p.file))
      .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    const name = `${path.basename(p.file, path.extname(p.file))}.jpg`;
    await writeFile(path.join(webDir, name), buf);
    const meta = await sharp(buf).metadata();
    p.web = {
      file: `web/${name}`,
      bytes: buf.length,
      width: meta.width,
      height: meta.height,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
  }
}

await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(records, null, 2)}\n`);

const posters = records.flatMap((r) => r.poster_files);
const rawMb = posters.reduce((s, p) => s + p.bytes, 0) / 1024 ** 2;
const webMb = posters.reduce((s, p) => s + (p.web?.bytes ?? 0), 0) / 1024 ** 2;
console.log(`\n${records.length}/${slugs.length} profiles captured in ${outDir}`);
console.log(
  `${posters.length} poster(s): originals ${rawMb.toFixed(2)} MiB -> web ${webMb.toFixed(2)} MiB (${webDir})`,
);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
}

/**
 * Rescue partner/organizer logos from the OLD congress sites into a local
 * staging tree (Issue #22).
 *
 * Why Playwright and not fetch: orthobio.ru (the operator's congress-ph
 * platform) and orthobio2021.creatium.site both render their logo grids from
 * JS — the 2026 recon pass was plain-HTML and saw no logos at all
 * (docs/recon/orthobio-ru-main.md). The browser also gives us naturalWidth /
 * naturalHeight, which is how a decorative sliver is told from a real mark.
 *
 * The script CRAWLS + DOWNLOADS only. Uploading to S3 and rewriting the content
 * YAML are separate, deliberately manual steps (see docs/assets-manifest.yaml
 * → `logos:` and infra/terraform/README.md for the upload runbook) because they
 * touch live paid infra and reviewed content.
 *
 *   node scripts/rescue-partner-logos.mjs [--out .rescue/logos]
 *
 * Output: <out>/<slug>.<ext> plus <out>/index.json (provenance + sha256 +
 * pixel dimensions), which is the input the manifest entries are written from.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';
import sharp from 'sharp';

const CDN = 'https://cdn.congress-ph.online/261';
const EXHIBITION = 'https://orthobio.ru/exhibition';
const INFO_PARTNERS = 'https://orthobio.ru/partners';
const ORGS = 'https://orthobio.ru/orgs';
const ARCHIVE_2025 = 'https://orthobio2021.creatium.site/archive/2025';

/**
 * The logo library, keyed by ORGANIZATION rather than by year: a logo is a
 * brand mark, so one object serves every edition the organization took part in
 * (the per-year mapping lives in the content YAML). `page` is the page the mark
 * was found on and is what goes into the manifest as `source`.
 *
 * A entry identifies its image either by `url` (congress-ph CDN — stable,
 * human-readable paths) or by `basename` (Creatium — content-addressed paths
 * that change whenever the owner re-uploads, so the only durable handle is the
 * original filename, which Creatium preserves).
 */
const LIBRARY = [
  // ── Организаторы — orthobio.ru/orgs (512×512 PNG, alt = full legal name) ──
  { slug: 'orto', page: ORGS, url: `${CDN}/orgs/1.png`, org: 'Общество регенеративной травматологии и ортопедии (ОРТО)' },
  { slug: 'ator', page: ORGS, url: `${CDN}/orgs/2.png`, org: 'Ассоциация травматологов-ортопедов России (АТОР)' },
  { slug: 'mapo', page: ORGS, url: `${CDN}/orgs/3.png`, org: 'Медицинская ассоциация по остеонекрозу (МАПО)' },
  { slug: 'cito', page: ORGS, url: `${CDN}/orgs/4.png`, org: 'НМИЦ ТО им. Н.Н. Приорова (ЦИТО)' },
  { slug: 'fnkc-fmba-kafedra', page: ORGS, url: `${CDN}/orgs/5.png`, org: 'Кафедра травматологии и ортопедии ФНКЦ ФМБА России' },

  // ── Соорганизаторы — orthobio2021.creatium.site/archive/2025 ─────────────
  // The 2026 site prints these as plain text in prog.pdf; the 2025 archive page
  // is the only place they exist as images.
  { slug: 'minzdrav', page: ARCHIVE_2025, basename: 'Министерство.jpg', org: 'Министерство здравоохранения РФ' },
  { slug: 'fmba', page: ARCHIVE_2025, basename: 'Федеральное медико-биологическое агентство России.jpg', org: 'Федеральное медико-биологическое агентство России' },
  { slug: 'vreden', page: ARCHIVE_2025, basename: 'Р Н И И Т О им. Р.Р. Вредена.jpg', org: 'НМИЦ ТО им. Р.Р. Вредена' },
  { slug: 'niir-nasonovoy', page: ARCHIVE_2025, basename: 'НИИР им. В.А. Насоновой.jpg', org: 'НИИР им. В.А. Насоновой' },
  { slug: 'rudn', page: ARCHIVE_2025, basename: 'Российский Университет Дружбы Народов.jpg', org: 'Российский университет дружбы народов' },
  { slug: 'msu', page: ARCHIVE_2025, basename: 'МГУ.jpg', org: 'МГУ им. М.В. Ломоносова' },
  { slug: 'rnimu', page: ARCHIVE_2025, basename: 'РНИМУ.jpg', org: 'РНИМУ им. Н.И. Пирогова' },
  { slug: 'sechenov', page: ARCHIVE_2025, basename: 'Первый МГМУ им. И. М. Сеченова.jpg', org: 'Первый МГМУ им. И.М. Сеченова' },
  { slug: 'mgmsu', page: ARCHIVE_2025, basename: 'МГМСУ им. А.И. Евдокимова.jpg', org: 'МГМСУ им. А.И. Евдокимова' },
  { slug: 'fnkc-fmba', page: ARCHIVE_2025, basename: 'ФНКЦ.jpg', org: 'ФНКЦ ФМБА России' },
  { slug: 'rmanpo', page: ARCHIVE_2025, basename: 'РМАНПО.jpg', org: 'РМАНПО' },
  { slug: 'vmeda', page: ARCHIVE_2025, basename: 'vmeda.jpg', org: 'Военно-медицинская академия им. С.М. Кирова' },
  { slug: 'rnch-petrovskogo', page: ARCHIVE_2025, basename: 'logo_rnch.jpg', org: 'РНЦХ им. акад. Б.В. Петровского' },

  // ── Экспоненты — orthobio.ru/exhibition (512×512 PNG) ────────────────────
  { slug: 'dr-reddys', page: EXHIBITION, url: `${CDN}/exhib/dr.reddys/logo.png`, org: 'Dr. Reddy’s Laboratories' },
  { slug: 'promomed', page: EXHIBITION, url: `${CDN}/exhib/promomed/logo.png`, org: 'ПРОМОМЕД, ПАО' },
  { slug: 'berlin-chemie', page: EXHIBITION, url: `${CDN}/exhib/berlin/logo.png`, org: 'Берлин-Хеми/А. Менарини, ООО' },
  { slug: 'viatris', page: EXHIBITION, url: `${CDN}/exhib/viatris/logo.png`, org: 'Виатрис, ООО' },
  { slug: 'nizhpharm', page: EXHIBITION, url: `${CDN}/exhib/nizhpharm/logo.png`, org: 'НИЖФАРМ, ГК' },
  { slug: 'panbio-pharm', page: EXHIBITION, url: `${CDN}/exhib/panbio/logo.png`, org: 'ПанБио Фарм, ООО' },
  { slug: 'haleon', page: EXHIBITION, url: `${CDN}/exhib/heleon/logo.png`, org: 'Хелеон Рус, АО' },
  { slug: 'csc-pharma', page: EXHIBITION, url: `${CDN}/exhib/CSCPharmaRussia/logo.png`, org: 'CSC Pharma Russia' },
  { slug: 'biomir-servis', page: EXHIBITION, url: `${CDN}/exhib/biomir/logo.png`, org: 'БИОМИР сервис' },
  { slug: 'generium', page: EXHIBITION, url: `${CDN}/exhib/generium/logo.png`, org: 'ГЕНЕРИУМ, АО' },
  { slug: 'kem', page: EXHIBITION, url: `${CDN}/exhib/kem/logo.png`, org: 'КЭМ, ООО' },
  { slug: 'rompharma', page: EXHIBITION, url: `${CDN}/exhib/rompharma/logo.png`, org: 'Ромфарма, ООО' },
  { slug: 'servier', page: EXHIBITION, url: `${CDN}/exhib/serve/logo.png`, org: 'Сервье, АО' },
  { slug: 'arm', page: EXHIBITION, url: `${CDN}/exhib/apm/logo.png`, org: 'АРМ, ООО' },
  { slug: 'bionoltra', page: EXHIBITION, url: `${CDN}/exhib/bionoltra/logo.png`, org: 'БИОНОЛТРА ЭС ЭЙ, ООО' },
  { slug: 'kardiomed', page: EXHIBITION, url: `${CDN}/exhib/kardiomed/logo.png`, org: 'КардиоМед, ООО' },
  { slug: 'multi-systems-technology', page: EXHIBITION, url: `${CDN}/exhib/malty/logo.png`, org: 'Малти-Системс Текнолоджи, ООО' },
  { slug: 'mt-tehnika', page: EXHIBITION, url: `${CDN}/exhib/mtteh/logo.png`, org: 'МТ Техника' },
  { slug: 'oksiterra', page: EXHIBITION, url: `${CDN}/exhib/oxyterma/logo.png`, org: 'ОКСИТЕРРА, ООО' },
  { slug: 'orfan-grupp', page: EXHIBITION, url: `${CDN}/exhib/ofran/logo.png`, org: 'Орфан групп, ООО' },
  { slug: 'severnaya-zvezda', page: EXHIBITION, url: `${CDN}/exhib/star/logo.png`, org: 'Северная звезда, НАО' },
  { slug: 'fbk', page: EXHIBITION, url: `${CDN}/exhib/fbk/logo.png`, org: 'ФБК, ООО' },

  // ── Информационные партнёры — orthobio.ru/partners (512×512 PNG) ─────────
  { slug: 'pmp-agency', page: INFO_PARTNERS, url: `${CDN}/partners/pmp-agency.png`, org: 'PMP Agency' },
  { slug: 'helpinver', page: INFO_PARTNERS, url: `${CDN}/partners/helpinver.png`, org: 'Helpinver' },
  { slug: 'omnidoctor', page: INFO_PARTNERS, url: `${CDN}/partners/omnidoctor.png`, org: 'OmniDoctor' },
  { slug: 'space-health', page: INFO_PARTNERS, url: `${CDN}/partners/spacehealth.png`, org: 'Space Health' },
  { slug: 'lvrach', page: INFO_PARTNERS, url: `${CDN}/partners/lvrach.png`, org: 'ЛВрач' },
  { slug: 'rusvrach', page: INFO_PARTNERS, url: `${CDN}/partners/rusvrach.png`, org: 'РусВрач' },
  { slug: 'innofarma', page: INFO_PARTNERS, url: `${CDN}/partners/innofarma.png`, org: 'InnoFarma' },
  { slug: 'eco-vector', page: INFO_PARTNERS, url: `${CDN}/partners/eco-vector.png`, org: 'Eco-Vector' },
  { slug: 'opinion-leader', page: INFO_PARTNERS, url: `${CDN}/partners/opleader.png`, org: 'Opinion Leader' },
];

const outDir = (() => {
  const i = process.argv.indexOf('--out');
  return path.resolve(i === -1 ? '.rescue/logos' : process.argv[i + 1]);
})();

/** Creatium serves content-addressed paths, so URLs are read off the live page. */
async function collectPageImages(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  await page.waitForTimeout(2500);
  return page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight, alt: i.alt }))
      .filter((i) => i.src.startsWith('http')),
  );
}

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

/**
 * The source pages label most marks with the organization's name in `alt`. That
 * is the only INDEPENDENT evidence that a hand-written LIBRARY row points at the
 * right company — without it the URL→organization binding is asserted by this
 * table and checked by nothing, which matters in six months when
 * cdn.congress-ph.online is gone (PR #36 review). So `alt` is captured verbatim
 * into index.json and disagreements are REPORTED, not enforced: an empty alt is
 * common, and a product-line mark legitimately disagrees with its exhibitor's
 * name («КЭМ» ↔ «regenlab»). A human reads the list; the run still succeeds.
 */
const norm = (s) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// 3 characters, not 4: «КЭМ, ООО» / «АРМ, ООО» / «ФБК, ООО» are whole legal
// names built from three-letter words, and a 4-char floor made every one of
// them disagree with ITSELF.
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 3));
const altAgrees = (alt, org) => {
  if (!alt?.trim()) return true;
  if (norm(alt) === norm(org)) return true;
  const [a, o] = [words(alt), words(org)];
  return [...o].some((w) => a.has(w)) || [...a].some((w) => o.has(w));
};
const unverified = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
const page = await ctx.newPage();

// Live page pass: proves each mark is really on the source page and yields its
// rendered pixel size (the check that rejects spacers and skewed booth art).
const seen = new Map();
for (const url of [...new Set(LIBRARY.map((l) => l.page))]) {
  const imgs = await collectPageImages(page, url);
  seen.set(url, imgs);
  console.log(`crawled ${url} → ${imgs.length} images`);
}

await mkdir(outDir, { recursive: true });
const index = [];
const problems = [];

for (const item of LIBRARY) {
  const onPage = seen.get(item.page) ?? [];
  const match = item.basename
    ? onPage.find((i) => decodeURIComponent(i.src).endsWith(`/${item.basename}`))
    : onPage.find((i) => i.src === item.url);
  if (!match) {
    problems.push(`${item.slug}: not present on ${item.page}`);
    continue;
  }
  const res = await ctx.request.get(match.src);
  if (!res.ok()) {
    problems.push(`${item.slug}: HTTP ${res.status()} for ${match.src}`);
    continue;
  }
  const body = await res.body();
  const mime = (res.headers()['content-type'] ?? '').split(';')[0].trim();
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    problems.push(`${item.slug}: unexpected content-type ${mime}`);
    continue;
  }
  if (!altAgrees(match.alt, item.org)) {
    unverified.push(`${item.slug}: alt «${match.alt.trim()}» shares no word with org «${item.org}»`);
  }
  const file = `${item.slug}.${ext}`;
  await writeFile(path.join(outDir, file), body);
  index.push({
    slug: item.slug,
    org: item.org,
    file,
    source_page: item.page,
    source_url: match.src,
    source_alt: match.alt?.trim() || null,
    content_type: mime,
    bytes: body.length,
    width: match.w,
    height: match.h,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
  console.log(`saved ${file} (${match.w}×${match.h}, ${body.length} B)`);
}

await browser.close();

/*
 * Web derivatives. The congress-ph platform serves every logo as a 512×512
 * PNG stored with no compression — 1.03 MB each, ~45 MB for the set, for a
 * mark that is painted into a 120px slot. Shipping the originals would put
 * tens of megabytes on the /partners page, so the bucket gets a derivative:
 * downscaled to LONG_SIDE and re-encoded.
 *
 * The transform is resize + re-encode ONLY. No recolouring, no background
 * removal: the source tiles are heterogeneous (some are white knockout marks
 * on the old site's green field, some are the company's own logo pasted onto
 * that field), so any "make the background transparent" pass would silently
 * mangle the second group. What the old site showed is what we ship.
 */
const LONG_SIDE = 240;
const webDir = path.join(outDir, 'web');
await mkdir(webDir, { recursive: true });

for (const entry of index) {
  const src = path.join(outDir, entry.file);
  const buf =
    entry.content_type === 'image/jpeg'
      ? await sharp(src).resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      : await sharp(src).resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, effort: 10 }).toBuffer();
  await writeFile(path.join(webDir, entry.file), buf);
  const meta = await sharp(buf).metadata();
  entry.web = {
    file: `web/${entry.file}`,
    bytes: buf.length,
    width: meta.width,
    height: meta.height,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const rawMb = index.reduce((s, e) => s + e.bytes, 0) / 1024 ** 2;
const webMb = index.reduce((s, e) => s + e.web.bytes, 0) / 1024 ** 2;
console.log(`\n${index.length}/${LIBRARY.length} logos staged in ${outDir}`);
console.log(`originals ${rawMb.toFixed(1)} MiB → web derivatives ${webMb.toFixed(2)} MiB (${webDir})`);
if (unverified.length) {
  console.warn(`\n${unverified.length} binding(s) the source alt does not confirm — read before trusting:`);
  for (const u of unverified) console.warn(`  - ${u}`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
}

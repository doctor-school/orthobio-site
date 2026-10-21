import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Every content raster ships as a build-time WebP from the Astro image
 * pipeline (Issue #125). A plain `<img src={mediaUrl(…)}>` hands the reader the
 * S3 original — a PNG logo or a 120 KB screenshot — and nothing else in the
 * suite notices: the box, the alt and the geometry are identical either way.
 *
 * Reads the built HTML, not the browser: the e2e run is the one gate that sees
 * `dist/` (the webServer builds it), and an `<img>` that is lazy and below the
 * fold never reaches a page request. Only `<img>`/`<source>` count — favicons,
 * the touch icon and og-image are `<link>`/`<meta>`, where PNG is correct.
 */
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const RASTER = /\.(png|jpe?g)(?:[?#]|$)/i;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

function imageUrls(html: string): string[] {
  return [...html.matchAll(/<(?:img|source)\b[^>]*>/gi)].flatMap(([tag]) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1];
    const srcset = /\ssrcset="([^"]*)"/i.exec(tag)?.[1];
    const fromSet = srcset ? srcset.split(',').map((c) => c.trim().split(/\s+/)[0]) : [];
    return [src, ...fromSet].filter((u): u is string => !!u).map((u) => u.replace(/&amp;/g, '&'));
  });
}

test('no built page serves a PNG/JPEG content image', () => {
  const files = htmlFiles(DIST);
  expect(files.length, 'dist/ must hold the built pages').toBeGreaterThan(0);
  const offenders = files.flatMap((file) =>
    imageUrls(readFileSync(file, 'utf8'))
      .filter((url) => RASTER.test(url))
      .map((url) => `${file.slice(DIST.length)}: ${url}`),
  );
  expect(offenders).toEqual([]);
});

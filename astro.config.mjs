// @ts-check
import { defineConfig } from 'astro/config';
// Static output only (SSG) — the site is plain files served from our own
// RF-accessible hosting (Timeweb); no adapters, no server runtime.
// `site` is the canonical production domain; it will drive canonical URLs
// plus robots.txt and sitemap.xml (Issue #57).
export default defineConfig({
  site: 'https://orthobio.ru',
  outDir: 'dist',
  // Preserve Astro 6 whitespace semantics during the v7 security upgrade.
  compressHTML: true,
  // No CSS framework: styling is the `.ob-*` layer over the tokens in
  // src/styles (AGENTS.md → Code style). Tailwind was removed at review of
  // PR #14 — no utility class was ever used.
  // Galleries render through <Image> (astro:assets), which refuses a remote
  // source unless its host is allowed here. The archive lives in our own
  // Timeweb bucket (s3.twcstorage.ru/orthobio-media, Issue #2); originals are
  // 5000px JPEGs, so build-time resizing is what keeps an archive year page
  // from shipping tens of megabytes to a phone on mobile data.
  image: {
    remotePatterns: [{ protocol: 'https', hostname: 's3.twcstorage.ru' }],
  },
});

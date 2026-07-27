// @ts-check
import { defineConfig } from 'astro/config';

// Static output only (SSG) — the site is plain files served from our own
// RF-accessible hosting (Timeweb); no adapters, no server runtime.
// `site` is the canonical production domain; it will drive canonical URLs
// and the sitemap once the public pages land (Issue #4).
export default defineConfig({
  site: 'https://orthobio.ru',
  outDir: 'dist',
  // TODO(#4): when galleries move to <Image> (astro:assets), add
  // `image.remotePatterns` for the S3 host(s) in ALLOWED_MEDIA_HOSTS
  // (src/content/schemas.ts) — remote images are rejected by <Image> otherwise.
});

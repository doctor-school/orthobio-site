// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// Static output only (SSG) — the site is plain files served from our own
// RF-accessible hosting (Timeweb); no adapters, no server runtime.
// `site` is the canonical production domain; it will drive canonical URLs
// and the sitemap once the public pages land (Issue #4).
export default defineConfig({
  site: 'https://orthobio.ru',
  outDir: 'dist',
  // Tailwind v4 ships as a Vite plugin (no @astrojs/tailwind integration on
  // Astro 6). The theme is CSS-first: src/styles/tokens.css holds the design
  // tokens and the @theme block; global.css is the single entry.
  vite: {
    plugins: [tailwindcss()],
  },
  // TODO(#4): when galleries move to <Image> (astro:assets), add
  // `image.remotePatterns` for the S3 host(s) in ALLOWED_MEDIA_HOSTS
  // (src/content/schemas.ts) — remote images are rejected by <Image> otherwise.
});

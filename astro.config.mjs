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
  // Galleries render through <Image> (astro:assets), which refuses a remote
  // source unless its host is allowed here. The archive lives in our own
  // Timeweb bucket (s3.twcstorage.ru/orthobio-media, Issue #2); originals are
  // 5000px JPEGs, so build-time resizing is what keeps an archive year page
  // from shipping tens of megabytes to a phone on mobile data.
  image: {
    remotePatterns: [{ protocol: 'https', hostname: 's3.twcstorage.ru' }],
  },
});

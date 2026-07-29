/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests — logic and VALUES. Geometry, a11y and whole-route rendering are
 * the e2e suite's job (`pnpm test:e2e`); this runner exists because the e2e
 * gate cannot see values: «фото 12» instead of «12 фото» is valid DOM that
 * passes both overflow and axe, and it shipped (PR #14 review).
 *
 * `getViteConfig` (Astro's own vite config) instead of a bare `defineConfig`:
 * it registers the plugin that compiles `.astro`, which lets a single component
 * be rendered through the container API when — and only when — a branch of it
 * is unreachable from every built route. `tests/unit/video-card.test.ts` is the
 * one such case today: `poster: null` is a promised fallback that no published
 * year exercises, so without this it was asserted by a comment (PR #46 review).
 * Everything else here stays pure logic.
 */
export default getViteConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

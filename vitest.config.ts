import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests — pure logic only (`src/lib/**`). Rendering, geometry and a11y are
 * the e2e suite's job (`pnpm test:e2e`); this runner exists because the e2e
 * gate cannot see VALUES: «фото 12» instead of «12 фото» is valid DOM that
 * passes both overflow and axe, and it shipped (PR #14 review).
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

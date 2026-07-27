import { defineConfig } from '@playwright/test';

/**
 * e2e config — one build, one preview server, Chromium.
 *
 * The suite runs against the PRODUCTION build (`pnpm build && pnpm preview`),
 * not the dev server: the static output is what ships, and the responsive /
 * a11y guarantees must hold for it.
 */
// Port 4331 (not Astro's default 4321) so a dev server of this or a sibling
// project never collides with the suite's own preview build.
const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:4331';
const PORT = new URL(BASE_URL).port || '4321';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

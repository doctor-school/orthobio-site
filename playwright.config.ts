import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

import { resolveE2eTarget } from './tests/e2e/_port';

/**
 * e2e config — one build, one preview server, Chromium.
 *
 * The suite runs against the PRODUCTION build (`pnpm build && pnpm preview`),
 * not the dev server: the static output is what ships, and the responsive /
 * a11y guarantees must hold for it.
 */
// Port, overrides (PW_PORT / PW_BASE_URL) and the reasoning behind deriving the
// port from this checkout's path: `tests/e2e/_port.ts`.
const WORKTREE_DIR = fileURLToPath(new URL('.', import.meta.url));
const { baseURL, port } = resolveE2eTarget(process.env, WORKTREE_DIR);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // With PW_BASE_URL the server is someone else's (already running locally, or
  // a deployment): declaring a webServer there would have Playwright build and
  // try to bind a port we never chose — under CI, where reuse is off, always.
  webServer:
    port === undefined
      ? undefined
      : {
          command: `pnpm build && pnpm preview --port ${port}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

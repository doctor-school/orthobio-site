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
// The port is derived from THIS checkout's absolute path, so parallel worktrees
// never share — and never silently reuse — each other's preview server (see
// `tests/e2e/_port.ts`). Override with PW_PORT, or with PW_BASE_URL to run
// against an already started server.
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
  webServer: {
    command: `pnpm build && pnpm preview --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

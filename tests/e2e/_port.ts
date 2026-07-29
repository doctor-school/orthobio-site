import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Per-worktree preview port for the e2e suite.
 *
 * ── Why not a fixed port ────────────────────────────────────────────────────
 * The suite runs `pnpm build && pnpm preview` and Playwright reuses an already
 * listening server outside CI. With one hardcoded port, two agents working in
 * two git worktrees of this repo share that port: whoever starts second skips
 * its own build and asserts against the OTHER worktree's output. That happened
 * (issue #34, hit while working on #19) and produced three false failures.
 *
 * Deriving the port from the absolute worktree path makes the collision
 * impossible by construction: different checkout → different port → no cross-
 * worktree reuse. `reuseExistingServer` stays on locally, where it is wanted —
 * it now can only ever match a server of the SAME worktree.
 *
 * ── Known limitation, accepted ──────────────────────────────────────────────
 * `reuseExistingServer` calls whatever answers on the port «our server»; it
 * cannot check WHO answered. Unrelated software squatting a derived port (the
 * window holds e.g. 11211 memcached, 11434 Ollama, 24678 Vite HMR) would still
 * be silently reused. Not closed here because every cheap fix is worse than the
 * ~0.1%-per-worktree risk: probing a marker path makes the suite hang for 180 s
 * the day that path is renamed, and switching reuse off for derived ports costs
 * a full rebuild on every local run. A squatted port fails loudly enough in
 * practice — the specs assert this site's own DOM.
 */

/**
 * Port window: above the privileged range and the usual dev ports (3000, 4321,
 * 5173, 8080), below both ephemeral ranges the OS allocates from for outbound
 * sockets (Linux 32768+, Windows 49152+). 22528 slots keep accidental hash
 * collisions negligible: even ten simultaneous worktrees collide with p ≈ 0.2%.
 */
export const PORT_RANGE_START = 10_240;
export const PORT_RANGE_SIZE = 22_528;

/**
 * Same checkout must always hash to the same port, so fold away the spellings
 * of one path that a shell, a symlink-free `git worktree` or Windows may hand
 * us: relative segments, separator flavour, a trailing slash and — on
 * case-insensitive Windows filesystems — letter case.
 */
function canonicalPath(worktreeDir: string): string {
  const absolute = resolve(worktreeDir).replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** Stable, collision-resistant port for a worktree's absolute path. */
export function portForWorktree(worktreeDir: string): number {
  const digest = createHash('sha256').update(canonicalPath(worktreeDir)).digest();
  return PORT_RANGE_START + (digest.readUInt32BE(0) % PORT_RANGE_SIZE);
}

export interface E2eTarget {
  /** What the tests navigate to. */
  baseURL: string;
  /**
   * What `astro preview` is told to listen on — and, by being absent, the
   * signal that there is nothing for us to start: with `PW_BASE_URL` the server
   * belongs to someone else, so the config must declare no `webServer` at all.
   */
  port?: number;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PW_PORT must be an integer in 1..65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}

/**
 * Rejects what `new URL` happily accepts but Playwright cannot reach: a missing
 * scheme parses as its own protocol (`localhost:5000` → protocol `localhost:`,
 * path `5000`) and would otherwise surface much later as a navigation timeout.
 */
function parseBaseUrl(raw: string): string {
  const invalid = new Error(`PW_BASE_URL must be an http(s) URL, got ${JSON.stringify(raw)}`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid;
  return raw.replace(/\/+$/, '');
}

/**
 * Resolution order: an explicit `PW_BASE_URL` (point the suite at an already
 * running or remote deployment — no server of ours) → an explicit `PW_PORT`
 * (pin the port, keep the local server) → the per-worktree hash.
 */
export function resolveE2eTarget(env: NodeJS.ProcessEnv, worktreeDir: string): E2eTarget {
  const explicitUrl = env.PW_BASE_URL?.trim();
  if (explicitUrl) return { baseURL: parseBaseUrl(explicitUrl) };

  const pinned = env.PW_PORT?.trim();
  const port = pinned ? parsePort(pinned) : portForWorktree(worktreeDir);
  return { baseURL: `http://localhost:${port}`, port };
}

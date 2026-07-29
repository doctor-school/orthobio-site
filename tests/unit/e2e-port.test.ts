import { describe, it, expect } from 'vitest';

import {
  PORT_RANGE_SIZE,
  PORT_RANGE_START,
  portForWorktree,
  resolveE2eTarget,
} from '../e2e/_port';

/**
 * The e2e suite cannot test its own bootstrap: by the time a spec runs, the
 * port has already been chosen and a server is up. So the guarantee that made
 * issue #34 — two worktrees never land on the same preview port, one worktree
 * always lands on the same one — is asserted here.
 */

const WIN = 'C:\\Users\\dev\\repos\\orthobio-site';
const POSIX = '/home/runner/work/orthobio-site/orthobio-site';

describe('portForWorktree', () => {
  it('is stable for one path across calls', () => {
    expect(portForWorktree(POSIX)).toBe(portForWorktree(POSIX));
    expect(portForWorktree(WIN)).toBe(portForWorktree(WIN));
  });

  it('separates sibling worktrees of the same repo', () => {
    const main = portForWorktree('/repos/orthobio-site');
    const a = portForWorktree('/repos/orthobio-site/.claude/worktrees/agent-a');
    const b = portForWorktree('/repos/orthobio-site/.claude/worktrees/agent-b');
    expect(new Set([main, a, b]).size).toBe(3);
  });

  it('ignores a trailing separator', () => {
    expect(portForWorktree(`${POSIX}/`)).toBe(portForWorktree(POSIX));
  });

  it('stays inside the non-privileged, non-ephemeral window', () => {
    for (let i = 0; i < 2_000; i += 1) {
      const port = portForWorktree(`/repos/wt-${i}`);
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START);
      expect(port).toBeLessThan(PORT_RANGE_START + PORT_RANGE_SIZE);
      // Ephemeral ranges the OS allocates outbound sockets from start here.
      expect(port).toBeLessThan(32_768);
    }
  });

  it('spreads realistic worktree paths without piling up on one port', () => {
    const ports = new Set(
      Array.from({ length: 500 }, (_, i) =>
        portForWorktree(`/repos/orthobio-site/.claude/worktrees/agent-${i}`),
      ),
    );
    // 500 draws from 22528 slots: a handful of birthday collisions is expected,
    // a hash that clusters is not.
    expect(ports.size).toBeGreaterThan(490);
  });
});

describe('resolveE2eTarget', () => {
  it('derives baseURL from the worktree when nothing is set', () => {
    const target = resolveE2eTarget({}, POSIX);
    expect(target.baseURL).toBe(`http://localhost:${portForWorktree(POSIX)}`);
    expect(target.port).toBe(portForWorktree(POSIX));
  });

  it('honours an explicit PW_PORT', () => {
    expect(resolveE2eTarget({ PW_PORT: '4331' }, POSIX)).toEqual({
      baseURL: 'http://localhost:4331',
      port: 4331,
    });
  });

  it('rejects a PW_PORT that is not a usable port', () => {
    for (const raw of ['0', '70000', 'nope', '80.5']) {
      expect(() => resolveE2eTarget({ PW_PORT: raw }, POSIX)).toThrow(/PW_PORT/);
    }
  });

  it('lets PW_BASE_URL win and takes its port', () => {
    expect(resolveE2eTarget({ PW_BASE_URL: 'http://127.0.0.1:5000/', PW_PORT: '4331' }, POSIX)).toEqual(
      { baseURL: 'http://127.0.0.1:5000', port: 5000 },
    );
  });

  it('falls back to the protocol default port for a portless PW_BASE_URL', () => {
    expect(resolveE2eTarget({ PW_BASE_URL: 'https://orthobio.ru' }, POSIX).port).toBe(443);
    expect(resolveE2eTarget({ PW_BASE_URL: 'http://orthobio.ru' }, POSIX).port).toBe(80);
  });
});

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The host-side allowlist in `infra/host/orthobio-apply-redirects`.
 *
 * Why this is a test and not a comment: that script is the LAST gate before a
 * generated snippet is installed into /etc/nginx on a host that also fronts
 * Mattermost and Zitadel, and it is a hand-written grep. It fails in two
 * directions, both invisible to every other check in this repo —
 *
 *  - too strict: it refuses OUR OWN generator output and every deploy dies at
 *    the apply step, long after CI went green. Issue #24 walked straight into
 *    this: the query-conditional redirects introduced multi-line location
 *    blocks, and the previous allowlist accepted single-line blocks only.
 *  - too loose: it installs something the generator would never emit.
 *
 * The regex under test is READ OUT OF THE SCRIPT rather than copied here, so
 * the two can never drift. The test evaluates the POSIX ERE subset in Node:
 * requiring a workstation `sh` made every rejection look successful when the
 * interpreter itself was missing on Windows.
 */

const SCRIPT = 'infra/host/orthobio-apply-redirects';
const SCRIPT_SOURCE = readFileSync(SCRIPT, 'utf8');

const hostShellValidator = (() => {
  const section = (from: string) => {
    const start = SCRIPT_SOURCE.indexOf(from);
    expect(start, `${SCRIPT} no longer contains "${from}"`).toBeGreaterThan(-1);
    const end = SCRIPT_SOURCE.indexOf('\nfi\n', start);
    return SCRIPT_SOURCE.slice(start, end + 4);
  };

  return `set -eu\n${section('# Allowlist:')}\n${section('# Block structure, by DEPTH')}\n`;
})();

/**
 * Expand the quoted shell assignments that define the host-side EREs. This is
 * deliberately a tiny evaluator for the assignment syntax used by the script,
 * not a general shell parser.
 */
const shellVariables = (() => {
  const values = new Map<string, string>();

  const expandDoubleQuoted = (raw: string): string => {
    let expanded = '';

    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];

      if (char === '\\') {
        const next = raw[index + 1];
        if (next !== undefined && '$`"\\'.includes(next)) {
          expanded += next;
          index += 1;
        } else {
          expanded += char;
        }
        continue;
      }

      if (char === '$' && /[A-Za-z_]/.test(raw[index + 1] ?? '')) {
        let end = index + 2;
        while (/[A-Za-z0-9_]/.test(raw[end] ?? '')) end += 1;
        const name = raw.slice(index + 1, end);
        const value = values.get(name);
        if (value === undefined) {
          throw new Error(`${SCRIPT} references ${name} before defining it`);
        }
        expanded += value;
        index = end - 1;
        continue;
      }

      expanded += char;
    }

    return expanded;
  };

  for (const line of SCRIPT_SOURCE.split('\n')) {
    const assignment = line.match(/^([A-Z][A-Z0-9_]*)=(['"])(.*)\2$/);
    if (!assignment) continue;

    const [, name, quote, raw] = assignment;
    values.set(name, quote === "'" ? raw : expandDoubleQuoted(raw));
  }

  return values;
})();

const allowlist = [
  'A_BLANK',
  'A_EXACT',
  'A_PREFIX',
  'A_ROOT',
  'A_OPEN',
  'A_IF',
  'A_RETURN',
  'A_CLOSE',
].map((name) => {
  const pattern = shellVariables.get(name);
  if (pattern === undefined) throw new Error(`${SCRIPT} no longer defines ${name}`);

  // `[[:space:]]` is the only POSIX character class used by the host regexes.
  // Keep it ASCII-sized: JavaScript `\s` also admits Unicode whitespace that
  // the production grep can reject under its host locale.
  const translated = pattern.replaceAll('[[:space:]]', '[\\t\\v\\f\\r ]');
  if (translated.includes('[[:')) {
    throw new Error(`${SCRIPT} uses an unsupported POSIX character class in ${name}`);
  }

  return new RegExp(translated);
});

const acceptsPortably = (snippet: string): boolean => {
  const lines = snippet.split('\n');
  if (lines.some((line) => !allowlist.some((pattern) => pattern.test(line)))) {
    return false;
  }

  let depth = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, '');
    if (depth === 0 && /^[\s]*(?:if|return)/.test(line)) return false;

    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    if (depth < 0) return false;
  }

  return depth === 0;
};

/**
 * Linux CI is the production-shell parity check. It is additive: every
 * security assertion runs through the portable validator on every OS, while
 * the host's actual grep/awk sections must agree whenever its interpreter is
 * available. Windows therefore needs no Git Bash or WSL.
 */
const acceptsWithHostShell = (snippet: string): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'redirect-allowlist-'));
  try {
    writeFileSync(join(dir, 'snippet.conf'), snippet);
    writeFileSync(join(dir, 'check.sh'), hostShellValidator);
    execFileSync('sh', ['check.sh'], {
      cwd: dir,
      env: { ...process.env, STAGED: 'snippet.conf' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Run the real allowlist over a candidate snippet. */
const accepts = (snippet: string): boolean => {
  const portableResult = acceptsPortably(snippet);
  if (process.platform === 'linux') {
    expect(acceptsWithHostShell(snippet), 'portable validator drifted from the host shell').toBe(
      portableResult,
    );
  }
  return portableResult;
};

describe('orthobio-apply-redirects allowlist', () => {
  it('accepts the committed generator output verbatim', () => {
    // The exact bytes the deploy ships. This is the assertion that would have
    // caught the Issue #24 breakage before it reached the host.
    expect(accepts(readFileSync('infra/nginx/redirects.generated.conf', 'utf8'))).toBe(true);
  });

  it('accepts the single-line block shapes that predate query conditions', () => {
    expect(accepts('location = /old { return 301 /new; }\n')).toBe(true);
    expect(
      accepts('location ^~ /archive/ { rewrite ^/archive/(.*)$ /arhiv/$1 permanent; }\n'),
    ).toBe(true);
    expect(
      accepts('location ~ ^/(?!\\.)(.*)$ { return 301 https://doctor.school/x/$1; }\n'),
    ).toBe(true);
  });

  it('accepts a multi-line query-conditional block', () => {
    expect(
      accepts(
        'location = /company {\n' +
          '    if ($arg_i = "dr.reddys") { return 301 /partners/dr-reddys/; }\n' +
          '    return 301 /partners;\n' +
          '}\n',
      ),
    ).toBe(true);
  });

  it('evaluates a candidate without shell-interpreting a temporary path', () => {
    expect(acceptsPortably('location = /old { return 301 /new; }\n')).toBe(true);
  });

  it.each([
    ['an include directive', 'include /etc/passwd;\n'],
    ['a server block', 'server {\n    listen 80;\n}\n'],
    ['a root directive inside a location', 'location = /c {\n    root /etc/nginx;\n}\n'],
    // `}` had to become an allowed LINE for multi-line blocks; balance is what
    // keeps it from closing the vhost's own `server {}`.
    ['an unbalanced closing brace', 'location = /c {\n}\n}\n'],
    ['an unclosed block', 'location = /c {\n    if ($arg_i = "a") { return 301 /x/; }\n'],
    [
      'a second directive smuggled into an if',
      'location = /c {\n    if ($arg_i = "a") { return 301 /x/; root /etc; }\n}\n',
    ],
    [
      'a variable sigil in the matched value',
      'location = /c {\n    if ($arg_i = "a$b") { return 301 /x/; }\n}\n',
    ],
    [
      'a quoted redirect target',
      'location = /c {\n    if ($arg_i = "a") { return 301 "/y"; }\n}\n',
    ],
    [
      'a semicolon inside the target',
      'location = /c {\n    if ($arg_i = "a") { return 301 /x;internal; }\n}\n',
    ],
  ])('refuses %s', (_label, snippet) => {
    expect(accepts(snippet)).toBe(false);
  });

  /**
   * The six snippets the PR #40 reviewer got past the previous gate, by running
   * the very same extracted sections through `sh`. Each is pinned here so the
   * fix is demonstrated rather than asserted.
   *
   * The first is the one that mattered: a single top-level `return` is valid
   * nginx inside the vhost's `server {}`, so it 301s the WHOLE SITE, passes
   * `nginx -t`, and therefore never triggers the rollback — the only bypass
   * whose blast radius was a served config rather than a rejected one.
   */
  it.each([
    ['a top-level return that would 301 the whole vhost', '    return 301 https://evil.example/;\n'],
    ['a top-level if, outside any block', '    if ($arg_i = "a") { return 301 /x/; }\n'],
    [
      'a balanced pair that still closes the vhost block',
      'location = /a {\n}\n}\nlocation = /b {\n',
    ],
    [
      'a brace hidden in a comment, balancing the books nginx never reads',
      'location = /a {\n    return 301 /b;\n}\n# {\n}\n',
    ],
    ['a protocol-relative target the browser resolves as external', 'location = /x { return 301 //evil.example/; }\n'],
    ['a schemeless host as the target', 'location = /x { return 301 evil.example; }\n'],
  ])('refuses the reviewer bypass: %s', (_label, snippet) => {
    expect(accepts(snippet)).toBe(false);
  });

  it('still accepts the November migration target, which is a foreign host by design', () => {
    // The absolute arm is a HOST ALLOWLIST, not a blanket ban: the platform
    // migration redirects to doctor.school, and that must keep working.
    expect(accepts('location = /program { return 301 https://doctor.school/orthobio-2027/program; }\n')).toBe(
      true,
    );
    expect(accepts('location = /program { return 301 https://evil.example/orthobio-2027/program; }\n')).toBe(
      false,
    );
  });
});

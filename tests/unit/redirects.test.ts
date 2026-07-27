import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRedirects, renderNginxRedirects, assertRenderable } from '../../scripts/redirects.mjs';

/**
 * The redirect map is the November migration plan in data form. The e2e suite
 * cannot cover it (nothing redirects yet) and `nginx -t` on the host only
 * catches syntax, not semantics — so the values live here: which status code
 * comes out, what a prefix move does to the tail of the path, and which
 * malformed entry must stop the build instead of reaching a config file that
 * an nginx serving three other vhosts will include.
 */

const yaml = (body: string) => `redirects:\n${body}`;

describe('parseRedirects', () => {
  it('treats an empty map as no redirects', () => {
    expect(parseRedirects('redirects: []')).toEqual([]);
    expect(parseRedirects('redirects:')).toEqual([]);
    expect(parseRedirects('')).toEqual([]);
  });

  it('defaults status to 301 and match to exact', () => {
    expect(parseRedirects(yaml('  - from: /old\n    to: /new\n'))).toEqual([
      { from: '/old', to: '/new', status: 301, match: 'exact' },
    ]);
  });

  it('keeps an explicit status and match', () => {
    expect(
      parseRedirects(yaml('  - from: /a\n    to: /b\n    status: 302\n    match: prefix\n')),
    ).toEqual([{ from: '/a', to: '/b', status: 302, match: 'prefix' }]);
  });

  it('accepts an absolute https target (the platform migration case)', () => {
    const [entry] = parseRedirects(
      yaml('  - from: /program\n    to: https://doctor.school/orthobio-2027/program\n'),
    );
    expect(entry.to).toBe('https://doctor.school/orthobio-2027/program');
  });

  it.each([
    ['a relative source', '  - from: old\n    to: /new\n'],
    ['a source with a query string', '  - from: /old?x=1\n    to: /new\n'],
    ['an http (not https) target', '  - from: /old\n    to: http://example.ru/\n'],
    ['a status nginx would not send', '  - from: /old\n    to: /new\n    status: 200\n'],
    ['an unknown match mode', '  - from: /old\n    to: /new\n    match: regex\n'],
    ['a self-redirect loop', '  - from: /same\n    to: /same\n'],
    ['a duplicate source', '  - from: /x\n    to: /a\n  - from: /x\n    to: /b\n'],
  ])('rejects %s', (_label, body) => {
    expect(() => parseRedirects(yaml(body))).toThrow();
  });

  it('rejects a target carrying nginx syntax', () => {
    // The whole point of validating: `}` would close the server block and
    // everything after it would be parsed at http level.
    expect(() => parseRedirects(yaml('  - from: /old\n    to: "/new; } server { listen 80"\n'))).toThrow();
    // `$` is an nginx variable sigil, not a URL character we ever emit.
    expect(() => parseRedirects(yaml('  - from: /old\n    to: /$document_root\n'))).toThrow();
  });
});

describe('renderNginxRedirects', () => {
  it('renders an exact redirect as a `location =` block, which outranks try_files', () => {
    const conf = renderNginxRedirects(parseRedirects(yaml('  - from: /old\n    to: /new\n')));
    expect(conf).toContain('location = /old { return 301 /new; }');
  });

  it('renders a prefix redirect so the remainder of the path is carried over', () => {
    const conf = renderNginxRedirects(
      parseRedirects(yaml('  - from: /archive\n    to: /arhiv\n    match: prefix\n')),
    );
    expect(conf).toContain('location ^~ /archive/ { rewrite ^/archive/(.*)$ /arhiv/$1 permanent; }');
  });

  it('escapes regex metacharacters that are legal in a URL', () => {
    const conf = renderNginxRedirects(
      parseRedirects(yaml('  - from: /a.b\n    to: /c\n    match: prefix\n')),
    );
    expect(conf).toContain('rewrite ^/a\\.b/(.*)$ /c/$1 permanent;');
  });

  it('uses the `redirect` flag for a temporary prefix move', () => {
    const conf = renderNginxRedirects(
      parseRedirects(yaml('  - from: /a\n    to: /b\n    status: 302\n    match: prefix\n')),
    );
    expect(conf).toContain('redirect;');
    expect(conf).not.toContain('permanent;');
  });

  it('emits a self-describing no-op when nothing has moved', () => {
    const conf = renderNginxRedirects([]);
    expect(conf).toContain('No redirects are active.');
    expect(conf).not.toContain('location');
  });

  it('always marks the output as generated', () => {
    expect(renderNginxRedirects([])).toContain('GENERATED');
  });
});

describe('assertRenderable', () => {
  it('refuses a method-preserving prefix redirect rather than downgrading it', () => {
    // nginx `rewrite` has two flags — permanent (301) and redirect (302). A
    // silent downgrade of a 308 to a 301 would change POST semantics.
    const entries = parseRedirects(yaml('  - from: /a\n    to: /b\n    status: 308\n    match: prefix\n'));
    expect(() => assertRenderable(entries)).toThrow(/prefix/);
  });

  it('allows 308 on an exact redirect', () => {
    const entries = parseRedirects(yaml('  - from: /a\n    to: /b\n    status: 308\n'));
    expect(assertRenderable(entries)).toHaveLength(1);
  });
});

describe('infra/redirects.yaml', () => {
  it('is valid and renderable as committed', () => {
    const entries = parseRedirects(readFileSync('infra/redirects.yaml', 'utf8'));
    expect(() => assertRenderable(entries)).not.toThrow();
  });

  it('matches the committed generated snippet', () => {
    // Guards the artefact a reviewer reads against drift from its source; CI
    // runs the generator too, but this fails in the fast unit run.
    const entries = assertRenderable(parseRedirects(readFileSync('infra/redirects.yaml', 'utf8')));
    expect(renderNginxRedirects(entries)).toBe(
      readFileSync('infra/nginx/redirects.generated.conf', 'utf8'),
    );
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRedirects, renderNginxRedirects, assertRenderable } from '../../scripts/redirects.mjs';
import { ROUTES } from '../e2e/_routes';

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
    // Both forms of every source are emitted, so these would collide into a
    // duplicated `location =` that nginx refuses, or into a redirect loop.
    ['a slash-variant duplicate source', '  - from: /x\n    to: /a\n  - from: /x/\n    to: /b\n'],
    ['a slash-variant self-redirect', '  - from: /x\n    to: /x/\n'],
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

  it.each([
    ['a semicolon in the target', '  - from: /old\n    to: "/new;internal"\n'],
    ['a semicolon in the source', '  - from: "/a;b"\n    to: /new\n'],
    ['a comment character in the target', '  - from: /old\n    to: "/new#frag"\n'],
    ['a comment character in an absolute target', '  - from: /old\n    to: "https://doctor.school/x#frag"\n'],
    ['a quote in the target', "  - from: /old\n    to: \"/new'x\"\n"],
    ['a semicolon in an absolute target', '  - from: /old\n    to: "https://doctor.school/x;y"\n'],
  ])('rejects %s — it would smuggle a directive into the location block', (_label, body) => {
    // `;` ends an nginx statement, so `to: /new;internal` used to render a
    // SECOND directive inside our own block, passing `nginx -t` and silently
    // 404-ing the route (PR #15 review). `#` would comment out the rest of the
    // line, including our closing `;` and `}`.
    expect(() => parseRedirects(yaml(body))).toThrow();
  });
});

describe('renderNginxRedirects', () => {
  it('renders an exact redirect as a `location =` block, which outranks try_files', () => {
    const conf = renderNginxRedirects(parseRedirects(yaml('  - from: /old\n    to: /new\n')));
    expect(conf).toContain('location = /old { return 301 /new; }');
  });

  it('covers both slash forms of an exact source, whichever form was written', () => {
    // The site answers /program and /program/ alike, so a map that only caught
    // one form would drop half the published URL space in November.
    const bare = renderNginxRedirects(parseRedirects(yaml('  - from: /program\n    to: /p\n')));
    const slashed = renderNginxRedirects(parseRedirects(yaml('  - from: /program/\n    to: /p\n')));
    for (const conf of [bare, slashed]) {
      expect(conf).toContain('location = /program { return 301 /p; }');
      expect(conf).toContain('location = /program/ { return 301 /p; }');
    }
  });

  it('does not emit a doubled slash for the root', () => {
    const conf = renderNginxRedirects(parseRedirects(yaml('  - from: /\n    to: https://doctor.school/x\n')));
    expect(conf).toContain('location = / { return 301 https://doctor.school/x; }');
    expect(conf).not.toContain('location = //');
  });

  it('renders a prefix redirect so the remainder of the path is carried over', () => {
    const conf = renderNginxRedirects(
      parseRedirects(yaml('  - from: /archive\n    to: /arhiv\n    match: prefix\n')),
    );
    expect(conf).toContain('location ^~ /archive/ { rewrite ^/archive/(.*)$ /arhiv/$1 permanent; }');
  });

  it('covers the bare subtree root, which `^~ /x/` does not match', () => {
    for (const from of ['/archive', '/archive/']) {
      const conf = renderNginxRedirects(
        parseRedirects(yaml(`  - from: ${from}\n    to: /arhiv\n    match: prefix\n`)),
      );
      expect(conf).toContain('location ^~ /archive/ {');
      expect(conf).toContain('location = /archive { return 301 /arhiv/; }');
    }
  });

  describe('whole-site move (`from: /`, `match: prefix`) — the November end state', () => {
    const conf = renderNginxRedirects(
      assertRenderable(
        parseRedirects(
          yaml('  - from: /\n    to: https://doctor.school/orthobio-2027\n    match: prefix\n'),
        ),
      ),
    );

    it('never emits `location ^~ /`, which collides with the vhost catch-all', () => {
      // `location ^~ /` is a second prefix location for `/` next to the vhost's
      // own `location /` — nginx -t fails and the host rolls the deploy back.
      expect(conf).not.toContain('location ^~ /');
    });

    it('uses a regex location, which outranks the vhost catch-all without conflicting', () => {
      expect(conf).toContain(
        'location ~ ^/(?!\\.)(.*)$ { return 301 https://doctor.school/orthobio-2027/$1; }',
      );
    });

    it('redirects the root itself', () => {
      expect(conf).toContain('location = / { return 301 https://doctor.school/orthobio-2027/; }');
    });

    it('spares dot-paths so ACME renewal and the dotfile deny keep working', () => {
      expect(conf).toContain('(?!\\.)');
    });

    it('accepts a method-preserving status, unlike a non-root prefix', () => {
      // The root case renders through `return`, which takes a code; `rewrite`
      // has only permanent/redirect, hence the restriction elsewhere.
      const entries = parseRedirects(
        yaml('  - from: /\n    to: https://doctor.school/x\n    status: 308\n    match: prefix\n'),
      );
      expect(() => assertRenderable(entries)).not.toThrow();
      expect(renderNginxRedirects(entries)).toContain('return 308 https://doctor.school/x/$1;');
    });
  });

  it('never emits the same exact location twice', () => {
    // nginx refuses a config with a duplicated `location =`, so the two-form
    // rendering must not collide with itself.
    const conf = renderNginxRedirects(
      parseRedirects(yaml('  - from: /a\n    to: /x\n  - from: /a/b\n    to: /y\n')),
    );
    const locations = conf.match(/^location = \S+/gm) ?? [];
    expect(new Set(locations).size).toBe(locations.length);
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

describe('coverage of the real route list (the November migration case)', () => {
  // ROUTES is the same list the e2e suite iterates, and it deliberately mixes
  // the two slash forms (`/archive/` next to `/archive/2026`). A migration map
  // written from it must catch every published URL in both forms.
  const target = (route: string) => `https://doctor.school/orthobio-2027${route === '/' ? '' : route}`;

  it.each(ROUTES.map((r) => [r]))('covers %s in both slash forms', (route) => {
    const conf = renderNginxRedirects(
      parseRedirects(yaml(`  - from: ${route}\n    to: ${target(route)}\n`)),
    );
    const bare = route !== '/' && route.endsWith('/') ? route.slice(0, -1) : route;
    expect(conf).toContain(`location = ${bare} {`);
    if (bare !== '/') expect(conf).toContain(`location = ${bare}/ {`);
  });

  it('renders the whole site map at once without a duplicate location', () => {
    const body = ROUTES.map((r) => `  - from: ${r}\n    to: ${target(r)}\n`).join('');
    const conf = renderNginxRedirects(assertRenderable(parseRedirects(yaml(body))));
    const locations = conf.match(/^location \S+ \S+/gm) ?? [];
    expect(new Set(locations).size).toBe(locations.length);
    // Two blocks per non-root route, one for the root.
    expect(locations).toHaveLength((ROUTES.length - 1) * 2 + 1);
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

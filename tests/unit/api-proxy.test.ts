import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The congress sign-up form talks to the platform API through a same-origin
 * nginx proxy (the API has no CORS). The e2e suite runs against `astro
 * preview`, not nginx, and `nginx -t` only checks syntax — so which paths are
 * proxied, to which upstream, and what the CSP allows are pinned here.
 */

const VHOSTS = [
  { file: 'infra/nginx/orthobio.ru.conf', api: 'api.doctor.school' },
  { file: 'infra/nginx/new.orthobio.ru.conf', api: 'api-main.stage.doctor.school' },
] as const;

const PROXIED = ['/api/v1/congress/sign-up', '/api/v1/public/specialties'] as const;

// Before #78 the policy was identical except for `form-action 'none'`.
const CSP =
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

/** Body of `location = <path> { ... }`, tracking nested braces (the `if`). */
function exactLocation(conf: string, path: string): string {
  const head = `location = ${path} {`;
  const start = conf.indexOf(head);
  if (start === -1) throw new Error(`no exact location for ${path}`);
  let depth = 0;
  for (let i = start + head.length - 1; i < conf.length; i++) {
    if (conf[i] === '{') depth++;
    if (conf[i] === '}' && --depth === 0) return conf.slice(start + head.length, i);
  }
  throw new Error(`unterminated location for ${path}`);
}

/** Config with comment lines removed, so prose cannot satisfy an assertion. */
const directives = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

describe.each(VHOSTS)('$file', ({ file, api }) => {
  const conf = directives(file);

  it('proxies exactly the two sign-up paths and no /api prefix', () => {
    const apiLocations = conf.match(/location\s+[^{]*\/api[^{]*\{/g) ?? [];
    expect(apiLocations.map((l) => l.replace(/\s+/g, ' '))).toEqual(
      PROXIED.map((p) => `location = ${p} {`),
    );
  });

  it.each(PROXIED)('sends %s to its own upstream with forwarding headers', (path) => {
    const body = exactLocation(conf, path);
    expect(body).toContain(`proxy_pass https://${api}${path.replace(/^\/api/, '')};`);
    expect(body).toContain(`proxy_set_header Host ${api};`);
    expect(body).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(body).toContain('proxy_set_header X-Forwarded-Proto https;');
    expect(body).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(body).toContain('proxy_ssl_server_name on;');
    expect(body).toContain('proxy_ssl_verify on;');
    // add_header in a location drops every inherited security header.
    expect(body).not.toContain('add_header');
    // Upstream status codes (400/409/429…) must reach the form untouched.
    expect(body).not.toContain('proxy_intercept_errors');
  });

  it('accepts only POST on sign-up, with a small body cap', () => {
    const body = exactLocation(conf, '/api/v1/congress/sign-up');
    expect(body).toMatch(/if \(\$request_method != POST\) \{\s*return 405;\s*\}/);
    expect(body).toContain('client_max_body_size 16k;');
  });

  it('does not proxy to the other environment', () => {
    const other = VHOSTS.find((v) => v.api !== api)!.api;
    expect(conf).not.toContain(`https://${other}/`);
  });

  it("changes only form-action to 'self' in the CSP", () => {
    expect(conf).toContain(`add_header Content-Security-Policy "${CSP}" always;`);
    expect(conf).not.toContain("form-action 'none'");
    expect(conf.match(/Content-Security-Policy/g)).toHaveLength(1);
  });
});

describe('redirect map', () => {
  // A redirect source on a proxied path would be a duplicate `location =`,
  // which nginx refuses — failing the deploy's reload for the whole host.
  it.each(['infra/redirects.yaml', 'infra/nginx/redirects.generated.conf'])(
    '%s never claims an /api path',
    (file) => {
      expect(directives(file)).not.toMatch(/\/api\//);
    },
  );
});

describe('deploy workflow', () => {
  it('exposes the SmartCaptcha site key as a Variable, not a Secret', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(workflow).toContain(
      'PUBLIC_SMARTCAPTCHA_SITEKEY: ${{ vars.SMARTCAPTCHA_SITEKEY }}',
    );
    expect(workflow).not.toContain('secrets.SMARTCAPTCHA');
  });
});

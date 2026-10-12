import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The congress sign-up form talks to the platform API through a same-origin
 * nginx proxy (the API has no CORS). The e2e suite runs against `astro
 * preview`, not nginx, and `nginx -t` only checks syntax — so which paths are
 * proxied, to which upstream, and what the CSP allows are pinned here.
 */

const VHOSTS = [
  { file: 'infra/nginx/orthobio.ru.conf', api: 'api.doctor.school', stageGate: false },
  { file: 'infra/nginx/new.orthobio.ru.conf', api: 'api-main.stage.doctor.school', stageGate: true },
] as const;

// The stage API sits behind basic auth; a host-side file (never in the repo)
// supplies the gate cookie. Glob, so an absent file is an empty include.
const STAGE_GATE_INCLUDE = 'include /etc/nginx/orthobio/stage-gate*.conf;';

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

describe.each(VHOSTS)('$file', ({ file, api, stageGate }) => {
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

  it.each(PROXIED)('leaves the cache map as the only Cache-Control on %s', (path) => {
    expect(exactLocation(conf, path)).toContain('proxy_hide_header Cache-Control;');
  });

  it.each(PROXIED)(
    stageGate
      ? 'passes the stage gate and never forwards a Basic challenge on %s'
      : 'carries no stage-gate include on %s',
    (path) => {
      const body = exactLocation(conf, path);
      if (stageGate) {
        expect(body).toContain(STAGE_GATE_INCLUDE);
        expect(body).toContain('proxy_hide_header WWW-Authenticate;');
      } else {
        expect(body).not.toContain('stage-gate');
      }
    },
  );

  it('never carries a gate secret in the repo', () => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/ds_stage_gate=(?!<STAGE_GATE_TOKEN>)/);
    expect(conf).not.toMatch(/proxy_set_header\s+Cookie/i);
    // Only clearing is allowed: a set Authorization would be a secret in git.
    expect(conf).not.toMatch(/proxy_set_header\s+Authorization\s+(?!""\s*;)/i);
  });

  it.each(PROXIED)(
    stageGate
      ? 'keeps the preview Basic credential at this edge on %s'
      : 'has no preview credential to strip on %s',
    (path) => {
      const body = exactLocation(conf, path);
      if (stageGate) {
        expect(body).toContain('proxy_set_header Authorization "";');
      } else {
        expect(body).not.toContain('Authorization');
      }
    },
  );

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

const PREVIEW_HTPASSWD = '/etc/nginx/orthobio-preview.htpasswd';

/** Every top-level `server { ... }` block, in file order. */
function serverBlocks(conf: string): string[] {
  const blocks: string[] = [];
  for (const match of conf.matchAll(/^server\s*\{/gm)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < conf.length; i++) {
      if (conf[i] === '{') depth++;
      if (conf[i] === '}' && --depth === 0) {
        blocks.push(conf.slice(match.index, i + 1));
        break;
      }
    }
  }
  return blocks;
}

/** A block's own directives, with every nested `{ ... }` removed. */
function topLevel(block: string): string {
  let body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
  while (/\{[^{}]*\}/.test(body)) body = body.replace(/\{[^{}]*\}/g, '');
  return body;
}

// Issue #119: the preview's force-open form writes to the stage API, so real
// sign-ups there were lost. The whole HTTPS preview is closed by basic auth.
describe('preview basic auth', () => {
  const [https, http] = serverBlocks(directives('infra/nginx/new.orthobio.ru.conf'));

  it('closes the whole HTTPS preview server at server level', () => {
    expect(https).toContain('listen 443 ssl;');
    const own = topLevel(https);
    expect(own).toMatch(/^\s*auth_basic "[^"]+";\s*$/m);
    expect(own).toContain(`auth_basic_user_file ${PREVIEW_HTPASSWD};`);
    expect(https).not.toMatch(/auth_basic\s+off/);
  });

  it('keeps the port-80 server a bare HTTPS redirect', () => {
    expect(http).toContain('listen 80;');
    expect(http).toContain('return 301 https://$host$request_uri;');
    expect(http).not.toContain('auth_basic');
  });

  it('still marks the preview noindex, on the 401 too', () => {
    expect(topLevel(https)).toContain('add_header X-Robots-Tag "noindex, nofollow" always;');
  });

  it('leaves the production vhost open', () => {
    expect(directives('infra/nginx/orthobio.ru.conf')).not.toContain('auth_basic');
  });
});

describe('provisioning', () => {
  const provision = readFileSync('infra/host/provision.sh', 'utf8');

  it('creates the root-only directory the stage-gate include reads', () => {
    expect(provision).toContain(
      'sudo -n install -d -o root -g root -m 0700 /etc/nginx/orthobio\n',
    );
  });

  it('refuses before any host mutation when the preview credential is absent', () => {
    expect(provision).toContain(`PREVIEW_HTPASSWD=${PREVIEW_HTPASSWD}\n`);
    const check = provision.indexOf('if ! sudo -n test -s "$PREVIEW_HTPASSWD"; then');
    expect(check).toBeGreaterThan(-1);
    expect(provision.slice(check, provision.indexOf('\nfi\n', check))).toContain('exit 1');
    expect(check).toBeLessThan(provision.indexOf('BACKUP=$(mktemp'));
    expect(check).toBeLessThan(provision.indexOf('CHANGES_STARTED=1'));
  });
});

describe('cache map', () => {
  it('marks the proxied API paths no-store', () => {
    expect(directives('infra/nginx/orthobio-cache-map.conf')).toMatch(
      /^\s*~\^\/api\/v1\/\s+"no-store";\s*$/m,
    );
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
  it('exposes both SmartCaptcha site keys as Variables, not Secrets', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(workflow).toContain(
      'PUBLIC_SMARTCAPTCHA_SITEKEY: ${{ vars.SMARTCAPTCHA_SITEKEY }}',
    );
    expect(workflow).toContain(
      'PUBLIC_SMARTCAPTCHA_SITEKEY_PREVIEW: ${{ vars.SMARTCAPTCHA_SITEKEY_PREVIEW }}',
    );
    expect(workflow).not.toContain('secrets.SMARTCAPTCHA');
  });
});

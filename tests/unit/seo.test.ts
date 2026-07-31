import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  STATIC_PUBLIC_ROUTES,
  buildPublicRoutes,
  renderRobots,
  renderSitemap,
} from '../../src/lib/seo';

const PRODUCTION_SITE = new URL('https://orthobio.ru');

describe('public SEO routes', () => {
  it('combines the fixed page map with content-driven years and profiles', () => {
    expect(
      buildPublicRoutes({
        years: [2024, 2026, 2025],
        profileSlugs: ['zeta', 'alpha'],
      }),
    ).toEqual([
      ...STATIC_PUBLIC_ROUTES,
      '/archive/2026/',
      '/archive/2025/',
      '/archive/2024/',
      '/partners/alpha/',
      '/partners/zeta/',
    ]);
  });

  it('refuses duplicate or technical URLs instead of silently publishing them', () => {
    expect(() =>
      buildPublicRoutes({ years: [2026, 2026], profileSlugs: [] }),
    ).toThrow(/duplicate canonical route/i);
    expect(() =>
      buildPublicRoutes({ years: [2026], profileSlugs: ['company?preview=true'] }),
    ).toThrow(/canonical route/i);
  });
});

describe('SEO artifacts', () => {
  const routes = buildPublicRoutes({
    years: [2026],
    profileSlugs: ['doctor-school'],
  });

  it('renders an allow-all robots file pointing only at the production sitemap', () => {
    expect(renderRobots(PRODUCTION_SITE)).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://orthobio.ru/sitemap.xml\n',
    );
  });

  it('renders one valid canonical URL per public route without preview URLs', () => {
    const sitemap = renderSitemap(PRODUCTION_SITE, routes);
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(locations).toEqual(routes.map((route) => new URL(route, PRODUCTION_SITE).href));
    expect(new Set(locations).size).toBe(locations.length);
    expect(sitemap).not.toContain('new.orthobio.ru');
  });
});

describe('release infrastructure', () => {
  const previewNginx = readFileSync('infra/nginx/new.orthobio.ru.conf', 'utf8');
  const productionNginx = readFileSync('infra/nginx/orthobio.ru.conf', 'utf8');
  const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const infrastructureDecisions = readFileSync(
    'docs/infrastructure-decisions.md',
    'utf8',
  );

  it('serves the branded document for unknown routes while preserving status 404', () => {
    expect(previewNginx).toMatch(/error_page\s+404\s+\/404\.html;/);
    expect(productionNginx).toMatch(/error_page\s+404\s+\/404\.html;/);
    expect(deploy).toContain('GET unknown route -> ${not_found_code}');
    expect(deploy).toContain('test "${not_found_code}" = "404"');
  });

  it('keeps preview noindex while the production vhost is indexable', () => {
    expect(previewNginx).toContain(
      'add_header X-Robots-Tag "noindex, nofollow" always;',
    );
    expect(previewNginx).toContain('Do not remove this line from the preview vhost');
    expect(previewNginx).not.toContain('Remove this line at the domain switchover');
    expect(productionNginx).not.toMatch(
      /^\s*add_header\s+X-Robots-Tag\b/m,
    );
    expect(infrastructureDecisions).toContain(
      'Do not delete the preview `X-Robots-Tag` header',
    );
    expect(infrastructureDecisions).toContain('separate production vhost');
    expect(previewNginx).toMatch(
      /add_header Content-Security-Policy ".*frame-ancestors 'none'.*" always;/,
    );
    expect(productionNginx).toMatch(
      /add_header Content-Security-Policy ".*frame-ancestors 'none'.*" always;/,
    );
  });

  it('serves apex and redirects www from one generic release root', () => {
    for (const nginx of [previewNginx, productionNginx]) {
      expect(nginx).toContain('root /var/www/orthobio-site/public;');
    }
    expect(productionNginx).toMatch(/server_name\s+orthobio\.ru;/);
    expect(productionNginx).toMatch(/server_name\s+www\.orthobio\.ru;/);
    expect(productionNginx).toContain('return 301 https://orthobio.ru$request_uri;');
    expect(productionNginx).toContain(
      'ssl_certificate /etc/letsencrypt/live/orthobio.ru/fullchain.pem;',
    );
    expect(productionNginx).toContain(
      'ssl_certificate_key /etc/letsencrypt/live/orthobio.ru/privkey.pem;',
    );
  });

  it('makes robots, sitemap and production-host alignment part of the live deploy gate', () => {
    expect(deploy).toContain('GET /robots.txt -> ${robots_code}');
    expect(deploy).toContain('GET /sitemap.xml -> ${sitemap_code}');
    expect(deploy).toContain('Sitemap: https://${SITE_HOST}/sitemap.xml');
    expect(deploy).toContain('canonical host does not match SITE_HOST');
    expect(deploy).toContain('SITE_HOST: ${{ vars.SITE_HOST }}');
    expect(deploy).toContain('SITE_INDEXABLE: ${{ vars.SITE_INDEXABLE }}');
    expect(deploy).not.toContain("vars.SITE_HOST || 'new.orthobio.ru'");
    expect(deploy).not.toContain("vars.SITE_INDEXABLE || 'false'");
    expect(deploy.indexOf('name: Validate release target')).toBeLessThan(
      deploy.indexOf('name: Publish to tools-prod-tw'),
    );
  });
});

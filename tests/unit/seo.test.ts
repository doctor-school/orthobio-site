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
  const nginx = readFileSync('infra/nginx/new.orthobio.ru.conf', 'utf8');
  const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');

  it('serves the branded document for unknown routes while preserving status 404', () => {
    expect(nginx).toMatch(/error_page\s+404\s+\/404\.html;/);
    expect(deploy).toContain('GET unknown route -> ${not_found_code}');
    expect(deploy).toContain('test "${not_found_code}" = "404"');
  });

  it('keeps preview noindex and installs focused static-site hardening', () => {
    expect(nginx).toContain('add_header X-Robots-Tag "noindex, nofollow" always;');
    expect(nginx).toMatch(
      /add_header Content-Security-Policy ".*frame-ancestors 'none'.*" always;/,
    );
  });

  it('makes robots, sitemap and production-host alignment part of the live deploy gate', () => {
    expect(deploy).toContain('GET /robots.txt -> ${robots_code}');
    expect(deploy).toContain('GET /sitemap.xml -> ${sitemap_code}');
    expect(deploy).toContain('Sitemap: https://${SITE_HOST}/sitemap.xml');
    expect(deploy).toContain('canonical host does not match SITE_HOST');
  });
});

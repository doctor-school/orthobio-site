import { profileHref } from './partners';

/**
 * Public page-map routes whose existence does not depend on congress content.
 *
 * Year and partner-profile routes are appended by `buildPublicRoutes()`. Keeping
 * the fixed map here lets the sitemap and the e2e route inventory consume the
 * same contract instead of maintaining two lists that can drift.
 */
export const STATIC_PUBLIC_ROUTES = [
  '/',
  '/program/',
  '/participants/',
  '/orgs/',
  '/nmo/',
  '/partners/',
  '/contacts/',
  '/faq/',
  '/archive/',
] as const;

interface PublicRouteSources {
  years: readonly number[];
  profileSlugs: readonly string[];
}

const assertCanonicalRoute = (route: string, seen: Set<string>): void => {
  if (!route.startsWith('/') || route.startsWith('//') || /[?#]/.test(route)) {
    throw new Error(`Invalid canonical route "${route}": expected one root-relative path`);
  }
  if (seen.has(route)) {
    throw new Error(`Duplicate canonical route "${route}"`);
  }
  seen.add(route);
};

/**
 * Every indexable page, deterministically ordered.
 *
 * Inputs come from the Content Layer, so adding a congress year or partner
 * profile updates the sitemap without editing a second page inventory.
 */
export const buildPublicRoutes = ({
  years,
  profileSlugs,
}: PublicRouteSources): string[] => {
  const routes = [
    ...STATIC_PUBLIC_ROUTES,
    ...[...years].sort((a, b) => b - a).map((year) => `/archive/${year}/`),
    ...[...profileSlugs].sort().map(profileHref),
  ];
  const seen = new Set<string>();
  for (const route of routes) assertCanonicalRoute(route, seen);
  return routes;
};

const xml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** Production robots policy. Preview indexing stays disabled at nginx level. */
export const renderRobots = (site: URL): string =>
  `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site.origin).href}\n`;

/** Standards-compliant XML sitemap over canonical production URLs only. */
export const renderSitemap = (site: URL, routes: readonly string[]): string => {
  const locations = routes.map((route) => {
    const location = new URL(route, `${site.origin}/`).href;
    return `  <url><loc>${xml(location)}</loc></url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locations,
    '</urlset>',
    '',
  ].join('\n');
};

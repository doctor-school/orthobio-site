import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { STATIC_PUBLIC_ROUTES } from '../../src/lib/seo';

/**
 * Every public route of the site (ТЗ §4 page map) — the single list the
 * responsive and a11y guards iterate. Fixed routes come from the production
 * SEO contract; years come from content below, so neither can join the sitemap
 * without entering the browser matrix too.
 *
 * One exception, `PROFILE_ROUTES` at the bottom: 22 instances of ONE template,
 * derived from the content instead of listed here.
 */
/**
 * Partner profile routes (`/partners/<slug>/`, Issue #24).
 *
 * DERIVED from the content, not listed above by hand, and that is the point:
 * there are 22 of them today, they are all one template, and a hand-written
 * list would have to be edited every time a roster changes — which is exactly
 * the edit everyone forgets. Reading the YAML means a profile added tomorrow is
 * covered by `partner-profiles.spec.ts` the moment it exists.
 *
 * They stay OUT of `ROUTES` on purpose: that list is the ТЗ §4 page map, one
 * entry per distinct layout, and pouring 22 instances of a single template into
 * it would multiply the whole responsive × a11y matrix for no new coverage.
 * The dedicated spec runs the same guards over every profile instead.
 */
const congressDir = fileURLToPath(new URL('../../src/content/congress', import.meta.url));

const congresses = readdirSync(congressDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => {
    const data = parse(readFileSync(`${congressDir}/${f}`, 'utf8')) as {
      draft?: boolean;
      year: number;
      partners?: { slug?: string | null }[];
    };
    return data;
  })
  .filter(({ draft }) => draft !== true);

/** Archive year routes only — derived from the same content that builds them. */
export const YEAR_ROUTES = congresses
  .map(({ year }) => `/archive/${year}/`)
  .sort((a, b) => b.localeCompare(a));

export const ROUTES = [...STATIC_PUBLIC_ROUTES, ...YEAR_ROUTES];

export const PROFILE_ROUTES: string[] = congresses
  .flatMap(({ partners }) =>
    (partners ?? [])
      .map((p) => p.slug)
      .filter((s): s is string => typeof s === 'string')
      .map((slug) => `/partners/${slug}/`),
  )
  .filter((route, i, all) => all.indexOf(route) === i)
  .sort();

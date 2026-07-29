import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

/**
 * Every public route of the site (ТЗ §4 page map) — the single list the
 * responsive and a11y guards iterate. A new page must be added here, so it can
 * never ship without an overflow + axe check.
 *
 * One exception, `PROFILE_ROUTES` at the bottom: 22 instances of ONE template,
 * derived from the content instead of listed here.
 */
export const ROUTES = [
  '/',
  '/program',
  '/participants',
  '/orgs',
  '/nmo',
  '/partners',
  '/contacts',
  '/faq',
  '/archive/',
  '/archive/2026',
  '/archive/2025',
  '/archive/2024',
  '/archive/2023',
  '/archive/2022',
  '/archive/2021',
] as const;

/** Archive year routes only — the data-driven year template. */
export const YEAR_ROUTES = ROUTES.filter((r) => /\/archive\/\d{4}$/.test(r));

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

export const PROFILE_ROUTES: string[] = readdirSync(congressDir)
  .filter((f) => f.endsWith('.yaml'))
  .flatMap((f) => {
    const data = parse(readFileSync(`${congressDir}/${f}`, 'utf8')) as {
      draft?: boolean;
      partners?: { slug?: string | null }[];
    };
    // A draft year is not routed (getCongressYears filters it), so its partners
    // must not be expected to have pages either.
    if (data.draft === true) return [];
    return (data.partners ?? [])
      .map((p) => p.slug)
      .filter((s): s is string => typeof s === 'string')
      .map((slug) => `/partners/${slug}/`);
  })
  .filter((route, i, all) => all.indexOf(route) === i)
  .sort();

/**
 * Typed content access for pages & components.
 *
 * Thin wrapper over `astro:content` so consumers import named, intention-
 * revealing helpers instead of passing collection-name string literals around
 * (same convention as `bbm-public-website/src/content/index.ts`). Schemas
 * (`./schemas`) remain the single source of types.
 *
 * Unaffected by the future CMS loader swap: when the source changes in
 * `content.config.ts`, these helpers and their callers stay as-is.
 */

import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

export type CongressEntry = CollectionEntry<'congress'>;
export type PageEntry = CollectionEntry<'page'>;

export { PARTNER_TIERS, PARTNER_TIER_LABELS } from './schemas';
export type { PartnerTier, PageBlock } from './schemas';

/**
 * Filename↔content invariant, enforced at the content layer so EVERY consumer
 * (pages iterating all years, direct `getEntry()` lookups) gets it — not just
 * one page's `getStaticPaths` (PR #7 review). A `2097.yaml` declaring
 * `year: 2096` is a copy-paste artifact and must fail the build loudly.
 */
const assertYearMatchesId = (entry: CongressEntry): CongressEntry => {
  if (String(entry.data.year) !== entry.id) {
    throw new Error(
      `congress/${entry.id}.yaml declares year=${entry.data.year} — filename and year must match`,
    );
  }
  return entry;
};

/**
 * All congress year editions, newest first.
 *
 * Draft entries (fixtures such as `2099.yaml`) are EXCLUDED — the public site
 * must never route or link to them (Issue #1 deferred this filtering to the
 * real pages, Issue #4). `getCongressYear()` still resolves a draft by id so a
 * fixture stays inspectable through the content API in tests.
 */
export const getCongressYears = async (): Promise<CongressEntry[]> =>
  (await getCollection('congress', ({ data }) => !data.draft))
    .map(assertYearMatchesId)
    .sort((a, b) => b.data.year - a.data.year);

/**
 * One congress year edition by year (entry id IS the year).
 *
 * Returns `undefined` for a year with no content file — callers MUST narrow
 * (render a 404 / honest «нет данных»), never `!`-assert: the set of years is
 * content, not code, and shrinks/grows without touching call sites.
 */
export const getCongressYear = async (
  year: number | string,
): Promise<CongressEntry | undefined> => {
  const entry = await getEntry('congress', String(year));
  return entry === undefined ? undefined : assertYearMatchesId(entry);
};

/**
 * Editorial copy of one static page by route slug (`nmo` → /nmo).
 *
 * Throws when the file is missing: a page whose copy vanished must fail the
 * BUILD, not render an empty shell in production.
 */
export const getPage = async (slug: string): Promise<PageEntry> => {
  const entry = await getEntry('page', slug);
  if (entry === undefined) {
    throw new Error(`Content Layer: missing src/content/pages/${slug}.yaml`);
  }
  return entry;
};

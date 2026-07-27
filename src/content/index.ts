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

export { PARTNER_TIERS, PARTNER_TIER_LABELS } from './schemas';
export type { PartnerTier } from './schemas';

/** All congress year editions, newest first. */
export const getCongressYears = async (): Promise<CongressEntry[]> =>
  (await getCollection('congress')).sort((a, b) => b.data.year - a.data.year);

/** One congress year edition by year (entry id IS the year). */
export const getCongressYear = (year: number | string) =>
  getEntry('congress', String(year));

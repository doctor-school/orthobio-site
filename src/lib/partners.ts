/**
 * Partner profile derivations — pure functions, no rendering (Issue #24).
 *
 * A profile is a partner record that carries a `slug`. Slugs are scoped to the
 * ORGANIZATION, not to a congress year: one company that exhibits in 2026 and
 * again in 2028 is one page at one URL, listed as a participant of both years.
 * That is why the collection, not the year file, is the unit of work here.
 */

import type { Congress } from '@/content/schemas';

type Partner = Congress['partners'][number];
/** A partner record known to carry a profile slug. */
export type ProfilePartner = Partner & { slug: string };

/** One organization's profile, plus every congress year it took part in. */
export interface PartnerProfile {
  slug: string;
  partner: ProfilePartner;
  /** Congress years this organization appears in, newest first. */
  years: number[];
}

/** Minimal shape this module needs from a congress entry. */
export interface ProfileSource {
  year: number;
  partners: readonly Partner[];
}

/**
 * Route of a profile page. The ONE place the URL shape is written down —
 * `getStaticPaths`, the card links and the redirect tests all read it from
 * here, so the path and its trailing slash cannot drift apart.
 *
 * Trailing slash on purpose: Astro's default `directory` build format emits
 * `/partners/<slug>/index.html`, and that is the canonical URL nginx serves
 * without a further redirect hop.
 */
export const profileHref = (slug: string): string => `/partners/${slug}/`;

/**
 * Every partner profile in the collection, ordered by first appearance in the
 * newest year (so the list is stable and mirrors the roster reading order).
 *
 * Sources are expected NEWEST FIRST (`getCongressYears()` order); the newest
 * record of an organization is the one whose content the page renders, because
 * a company's address and description are current facts, not historical ones.
 *
 * A slug reused by two DIFFERENT organizations is a build error, not a
 * silently-resolved collision: the schema can only police duplicates inside one
 * year (`congressSchemaChecked`), and across years the failure mode is a page
 * that shows one company under another's roster — precisely the kind of wrong
 * VALUE the e2e suite is structurally unable to see (AGENTS.md).
 */
export const partnerProfiles = (sources: readonly ProfileSource[]): PartnerProfile[] => {
  const profiles = new Map<string, PartnerProfile>();

  for (const source of sources) {
    for (const partner of source.partners) {
      if (partner.slug === null) continue;
      const existing = profiles.get(partner.slug);
      if (existing === undefined) {
        profiles.set(partner.slug, {
          slug: partner.slug,
          partner: partner as ProfilePartner,
          years: [source.year],
        });
        continue;
      }
      if (existing.partner.name !== partner.name) {
        throw new Error(
          `partner profile slug "${partner.slug}" is claimed by two organizations: ` +
            `«${existing.partner.name}» and «${partner.name}» (congress ${source.year}) — ` +
            'one slug is one page, so give the second organization its own slug',
        );
      }
      existing.years.push(source.year);
    }
  }

  for (const profile of profiles.values()) profile.years.sort((a, b) => b - a);
  return [...profiles.values()];
};

/**
 * Link target of a partner card.
 *
 * A profile wins over the partner's own website: the card's job is to open what
 * we can show about the organization, and the external site is offered from
 * inside the profile. Without a profile the card behaves exactly as it did
 * before Issue #24 — the company's own site, or nothing at all.
 */
export const partnerCardHref = (partner: Partner): string | null =>
  partner.slug !== null ? profileHref(partner.slug) : partner.url;

/** Does a partner have anything to show on a profile page beyond its name? */
export const hasProfileBody = (partner: ProfilePartner): boolean =>
  partner.description.length > 0 || partner.address !== null || partner.contacts !== null;

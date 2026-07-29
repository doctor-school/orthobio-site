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
 * Route of a profile page.
 *
 * Read by `partnerCardHref()` below and by `redirects.test.ts`, which asserts
 * every `/company?i=…` entry in `infra/redirects.yaml` targets exactly this
 * string — so a slug renamed on one side alone fails the build. (The route
 * ITSELF comes from the filename `[slug].astro`; Astro builds it from
 * `getStaticPaths`'s `params`, not from this function. The invariant this
 * function actually carries is that the redirect map and the links agree with
 * that route, trailing slash included.)
 *
 * Trailing slash on purpose: Astro's default `directory` build format emits
 * `/partners/<slug>/index.html`, and that is the canonical URL nginx serves
 * without a further redirect hop.
 */
export const profileHref = (slug: string): string => `/partners/${slug}/`;

/**
 * Characters that mean the published string holds MORE THAN ONE number, and so
 * cannot be turned into a single dialable target.
 *
 * «КардиоМед» publishes «+7 495 955 52 57 / 58 / 40» — one switchboard with
 * three extensions. Stripping the separators yields +749595552575840, a
 * 16-digit number that does not exist, and the defect is invisible to everyone
 * except the person who taps it (the visible text stays right).
 */
const MULTI_NUMBER = /[/,;]|доб\./i;

/**
 * `tel:` target for a published phone string, or `null` when the string does
 * not denote exactly one number.
 *
 * Null is a first-class answer, not a failure: the page then prints the phone
 * as plain text. ONE UNLINKED PHONE IS HONEST; one wrong tel: is not — and
 * reconstructing «/ 58 / 40» into full numbers would be inventing digits the
 * source never published, which the whole content model forbids.
 *
 * This lives here rather than in the template because it is the only real logic
 * on the profile page, and a wrong VALUE is exactly what the e2e suite cannot
 * see (AGENTS.md; «фото 12» shipped that way in PR #14).
 */
export const telHref = (phone: string): string | null => {
  if (MULTI_NUMBER.test(phone)) return null;
  const trimmed = phone.trim();
  // `+` carries meaning (international dialling) and is legal in a tel: URI, so
  // it survives — but only where the source put it, at the very front.
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  // A Russian city or mobile number is 10 digits plus the country code; short
  // codes («8 800 …» is 11) are covered too. Anything shorter is not a number
  // we can dial, so it stays text.
  return digits.length >= 10 ? `${plus}${digits}` : null;
};

/** Max length of a rendered `<meta name="description">`, in characters. */
export const META_DESCRIPTION_MAX = 160;

/**
 * Trim rescued prose down to a meta description.
 *
 * The partners wrote their own copy and some opening paragraphs run past 450
 * characters, which a search engine cuts mid-word at ~160. Cutting it ourselves
 * at a SENTENCE boundary keeps the snippet a whole thought.
 *
 * The sentence probe deliberately requires three letters before the full stop
 * and a capital after it: Russian business prose is full of «в г. Хайдерабад»,
 * «д. 10», «стр. 1», and a naive `. ` search would end the description on an
 * abbreviation. When no clean sentence break fits, it falls back to a word
 * boundary plus an ellipsis, which is never wrong — only less elegant.
 */
export const metaDescription = (text: string, max: number = META_DESCRIPTION_MAX): string => {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;

  const window = clean.slice(0, max + 1);
  let sentenceEnd = -1;
  for (const m of window.matchAll(/\p{L}{3}([.!?])\s+(?=\p{Lu})/gu)) {
    sentenceEnd = m.index + m[0].indexOf(m[1]) + 1;
  }
  if (sentenceEnd > 0) return clean.slice(0, sentenceEnd);

  const cut = window.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).replace(/[\s.,;:—–-]+$/u, '')}…`;
};

/**
 * A run of description entries, grouped for rendering.
 *
 * `description[]` is «one entry = one paragraph» plain text (the loader-swap
 * invariant: no rich-text ASTs, ever). But some rescued entries are LIST ITEMS,
 * and the source encoded them the only way plain text can — with a leading
 * «·»: ПанБио Фарм lists «· ревматология,» through «· кардиология…» as seven
 * consecutive entries.
 *
 * Rendering those as seven `<p>`s each opening with a literal «·» gives a
 * screen reader no list to announce and puts a typographic glyph where markup
 * belongs. So the marker stays in the YAML — it is the only signal that
 * survives the CMS loader swap, and dropping it there would destroy the
 * information — and is translated HERE into a real `<ul>`, with the bullet
 * drawn by CSS.
 */
export type DescriptionBlock =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] };

/**
 * The plain-text list marker, and the ONLY one.
 *
 * Deliberately excludes the ASCII hyphen that two rescued entries originally
 * used: `prose()` runs Typograf at the schema boundary, which rewrites a
 * leading «- » into an em dash long before this function sees it. Matching «-»
 * here would therefore be dead code that reads as though it worked, and
 * matching «—» instead would swallow any paragraph that legitimately opens with
 * a dash. So the content is normalized to «·» — one marker, chosen because it
 * is the one Typograf leaves alone.
 */
const BULLET = /^[·•‣]\s+/;

export const descriptionBlocks = (paragraphs: readonly string[]): DescriptionBlock[] => {
  const blocks: DescriptionBlock[] = [];
  for (const paragraph of paragraphs) {
    if (!BULLET.test(paragraph)) {
      blocks.push({ kind: 'text', text: paragraph });
      continue;
    }
    const item = paragraph.replace(BULLET, '').trim();
    const last = blocks.at(-1);
    if (last?.kind === 'list') last.items.push(item);
    else blocks.push({ kind: 'list', items: [item] });
  }
  return blocks;
};

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

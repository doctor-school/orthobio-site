import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PARTNER_TIERS, type PartnerTier } from '@/content/schemas';

/**
 * The tier marker of `PartnerTier` (Issue #27) — a 9px dot whose COLOUR is the
 * partnership hierarchy.
 *
 * Why a unit test for a CSS rule: the marker is a value, and values are exactly
 * what the e2e gate cannot see. A dot painted in the wrong token still has its
 * 9×9 box, still passes overflow and axe, and — being `aria-hidden` decoration
 * — cannot even be read back from the accessible tree. The port that dropped
 * the marker entirely was found by eye, months later, not by CI.
 *
 * Three things are pinned here:
 *  1. tier → token, against the Claude.design bundle's own `TIER_DOT` map;
 *  2. total coverage — every tier the schema allows owns a rule, so adding a
 *     tier to `PARTNER_TIERS` fails here instead of shipping a grey dot;
 *  3. the tokens named actually exist in `tokens.css` — a typo in a custom
 *     property name is not an error anywhere in CSS, it is a transparent dot.
 *
 * `identity.spec.ts` then asserts the same ramp as PAINTED pixels; this file
 * asserts it is the ramp the design asked for.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const COMPONENTS_CSS = read('../../src/styles/components.css');
const TOKENS_CSS = read('../../src/styles/tokens.css');

/**
 * Verbatim from `components/partners/PartnerTier.jsx` of the Claude.design
 * bundle (v2), where it is applied as an inline style; this repo forbids inline
 * `style=` and carries the map as per-tier classes instead.
 *
 * The ramp DESCENDS: the parent brand's blues for the people who run the
 * congress, the congress accents for the paying tiers (sky → green → lime),
 * neutral for the two tiers below them.
 */
const TIER_DOT: Record<PartnerTier, string> = {
  organizer: '--ds-blue-dark',
  'co-organizer': '--ds-blue',
  strategic: '--ob-sky',
  general: '--ob-green',
  partner: '--ob-lime',
  exhibition: '--hairline',
  info: '--hairline',
};

/** `.ob-pt__dot--<tier> { … background: var(--token) … }`, as authored. */
const declaredDots = (): Record<string, string> => {
  const rules = COMPONENTS_CSS.matchAll(
    /\.ob-pt__dot--([a-z-]+)\s*\{([^}]*)\}/g,
  );
  const map: Record<string, string> = {};
  for (const [, tier, body] of rules) {
    const background = body.match(/background:\s*var\((--[a-z0-9-]+)\)/);
    if (background) map[tier] = background[1];
  }
  return map;
};

describe('PartnerTier tier markers', () => {
  it('paints every tier with the token the design bundle assigns it', () => {
    expect(declaredDots()).toEqual(TIER_DOT);
  });

  it('covers every tier the schema allows', () => {
    const declared = Object.keys(declaredDots()).sort();
    expect(declared).toEqual([...PARTNER_TIERS].sort());
  });

  it('names only tokens that tokens.css actually defines', () => {
    for (const token of new Set(Object.values(TIER_DOT))) {
      expect(TOKENS_CSS, `${token} must be declared in tokens.css`).toContain(`${token}:`);
    }
  });

  /**
   * The dot is the only geometry the rule owns: a lost `border-radius` turns
   * the marker into a square, which reads as a broken glyph rather than as the
   * design's bullet, and a lost `display` collapses an empty span to nothing at
   * all — the #27 regression, one property further down.
   */
  it('keeps the bundle geometry: a 9px pill riding the heading text', () => {
    const base = COMPONENTS_CSS.match(/\.ob-pt__dot\s*\{([^}]*)\}/);
    expect(base, '.ob-pt__dot must exist').not.toBeNull();
    const body = base?.[1] ?? '';
    expect(body).toMatch(/display:\s*inline-block/);
    expect(body).toMatch(/width:\s*9px/);
    expect(body).toMatch(/height:\s*9px/);
    expect(body).toMatch(/border-radius:\s*var\(--r-pill\)/);
    // Optical centre of the capitals, not the baseline an empty inline box
    // would otherwise sit on.
    expect(body).toMatch(/vertical-align:\s*middle/);
  });
});

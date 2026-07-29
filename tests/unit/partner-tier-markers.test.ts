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
   * design's bullet, and a marker back IN the text flow costs the heading the
   * full 19px again (see the hanging arithmetic below).
   */
  it('keeps the bundle geometry: a 9px pill, out of the text flow', () => {
    const base = COMPONENTS_CSS.match(/\.ob-pt__dot\s*\{([^}]*)\}/);
    expect(base, '.ob-pt__dot must exist').not.toBeNull();
    const body = base?.[1] ?? '';
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset-inline-start:\s*0/);
    expect(body).toMatch(/width:\s*9px/);
    expect(body).toMatch(/height:\s*9px/);
    expect(body).toMatch(/border-radius:\s*var\(--r-pill\)/);
    // Centred on the FIRST line box of the heading, so a label that wraps keeps
    // its marker beside the first line instead of halfway down the block.
    expect(body).toMatch(/top:\s*calc\(\(1em \* var\(--lh-h3\) - 9px\) \/ 2\)/);
  });

  /**
   * The hanging arithmetic, pinned because it is the whole reason the marker
   * does not cost what the bundle's in-flow version costs.
   *
   * The heading reserves 19px (9px dot + the bundle's 10px gap) and hands 10px
   * of it back to the row, so the marker overhangs into the page gutter and
   * only 9px comes out of the words. `--container-pad` is 16px at its narrowest
   * (a phone), which is what keeps a 10px overhang inside the viewport — make
   * the overhang bigger than that and the dot is clipped by the screen edge.
   */
  it('hangs the marker in the gutter instead of spending the heading’s width', () => {
    const title = COMPONENTS_CSS.match(/\.ob-pt__title\s*\{([^}]*)\}/)?.[1] ?? '';
    const overhang = title.match(/margin-inline-start:\s*-(\d+)px/);
    const reserved = title.match(/padding-inline-start:\s*(\d+)px/);
    expect(reserved?.[1], 'the heading must reserve the marker slot').toBe('19');
    expect(overhang?.[1], 'and hand part of it back to the row').toBe('10');
    expect(Number(overhang?.[1]), 'the overhang must fit the narrowest gutter').toBeLessThan(16);
    // Without it the heading cannot shrink, and the count is pushed out of the
    // container instead of the text wrapping.
    expect(title).toMatch(/min-width:\s*0/);

    const header = COMPONENTS_CSS.match(/\.ob-pt__h\s*\{([^}]*)\}/)?.[1] ?? '';
    // The bundle declares no `flex-wrap`; wrapping this row can only strand the
    // count on a line of its own.
    expect(header).toMatch(/flex-wrap:\s*nowrap/);
    expect(COMPONENTS_CSS.match(/\.ob-pt__count\s*\{([^}]*)\}/)?.[1] ?? '').toMatch(
      /flex:\s*none/,
    );
  });
});

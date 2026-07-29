import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PARTNER_TIERS } from '@/content/schemas';
import { TIER_DOT } from '../tier-dot';

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
    expect(declaredDots()).toEqual({ ...TIER_DOT });
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
   * the marker into a square, which reads as a broken glyph rather than the
   * design's bullet, and a marker back in the text flow no longer sits at a
   * predictable place at all.
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
   * The slot the marker is positioned in, and the two properties that keep the
   * row it lives in honest.
   *
   * 19px inside the column is the bundle's own arithmetic (a 9px flex item plus
   * the row's 10px gap), so the DOT lands on the column edge — in line with the
   * h1 and the card grid — and the heading text starts after it. A negative
   * `margin-inline-start` would hang the slot out into the page gutter instead:
   * that gutter is `--container-pad`, 16px on a phone, so a full 19px overhang
   * clips the dot against the screen edge and a partial one aligns nothing.
   */
  it('reserves the marker slot inside the column, never out in the gutter', () => {
    const title = COMPONENTS_CSS.match(/\.ob-pt__title\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(
      title.match(/padding-inline-start:\s*(\d+)px/)?.[1],
      'the heading must reserve the marker slot',
    ).toBe('19');
    expect(title, 'the slot must not hang into the page gutter').not.toMatch(
      /margin-inline-start:\s*-/,
    );
    // The marker's `top` is expressed in the heading's own line box, so the
    // line height it is derived from has to stay declared here.
    expect(title).toMatch(/line-height:\s*var\(--lh-h3\)/);
    expect(title).toMatch(/font-size:\s*var\(--fs-h3\)/);
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

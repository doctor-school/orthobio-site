import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * WCAG 2.2 SC 1.4.11 for the global focus indicator (issue #35).
 *
 * Why this is a test and not a review note: the ring is ONE pair of tokens
 * applied by ONE global `:focus-visible` rule, so it renders over every surface
 * the site paints — and nothing else in the suite can see it. axe does not
 * measure focus indicators (it audits the resting document; the ring only
 * exists while an element is focused and it is a `box-shadow`, which axe's
 * colour-contrast rule does not sample at all), and a screenshot diff would
 * report «changed», not «below 3:1». The failure mode is silent and it already
 * happened once: `--focus-ring` sat at `#6BB1F7` — 2.27:1 on the white page —
 * from the first port until the audit of PR #29 caught it.
 *
 * The values are READ OUT OF `tokens.css` rather than restated here, so the
 * test measures what ships. The surface list is maintained by hand because it
 * is a claim about the DESIGN, not about the CSS: it enumerates every backdrop
 * a focused element can sit on, and a new tinted band or dark plate has to be
 * added to it deliberately.
 */

const tokensCss = readFileSync(
  fileURLToPath(new URL('../../src/styles/tokens.css', import.meta.url)),
  'utf8',
);

const baseCss = readFileSync(
  fileURLToPath(new URL('../../src/styles/base.css', import.meta.url)),
  'utf8',
);

const componentsCss = readFileSync(
  fileURLToPath(new URL('../../src/styles/components.css', import.meta.url)),
  'utf8',
);

/** Resolves `--name`, following one level of `var(--other)` indirection. */
function token(name: string): string {
  const seen = new Set<string>();
  let value = name;
  while (!seen.has(value)) {
    seen.add(value);
    const declared = new RegExp(`^\\s*--${value.replace(/^--/, '')}:\\s*([^;]+);`, 'm').exec(
      tokensCss,
    );
    if (!declared) throw new Error(`token ${value} is not declared in tokens.css`);
    const raw = declared[1].trim();
    const indirect = /^var\((--[\w-]+)\)$/.exec(raw);
    if (!indirect) return raw;
    value = indirect[1];
  }
  throw new Error(`token ${name} resolves in a cycle`);
}

// ── Colour maths ──────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.x relative luminance. */
const luminance = ([r, g, b]: RGB) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (value: string): RGB => {
  const h = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
};

/**
 * Parses the two colour notations `tokens.css` actually uses — `#rrggbb` and
 * `oklch(L C H)` with an optional `/ alpha` — into an opaque colour plus its
 * alpha. Anything else throws rather than being quietly skipped: a token that
 * grows a third notation must be understood here, not measured as black.
 */
function parseColour(raw: string): { rgb: RGB; alpha: number } {
  const value = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return { rgb: hex(value), alpha: 1 };

  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (ok) {
    return {
      rgb: oklch(Number(ok[1]), Number(ok[2]), Number(ok[3])),
      alpha: ok[4] === undefined ? 1 : Number(ok[4]),
    };
  }
  throw new Error(`focus-ring test cannot measure the colour notation ${JSON.stringify(raw)}`);
}

/** The colour a token names, composited over `backdrop` if it is translucent. */
function surfaceOf(name: string, backdrop: RGB = WHITE): RGB {
  const { rgb, alpha } = parseColour(token(name));
  return alpha === 1 ? rgb : over(rgb, backdrop, alpha);
}

/** oklch → sRGB (Ottosson's matrices), for the neutral ramp and the scrims. */
function oklch(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Alpha-composites `fg` over `bg` — the scrims are translucent. */
const over = (fg: RGB, bg: RGB, alpha: number): RGB =>
  fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;

const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];

// ── The surfaces a focus ring can land on ─────────────────────────────────────

/**
 * Both photo-backed cases are listed at BOTH extremes: the congress photography
 * is mostly white-walled halls, but a dark frame composites differently, and a
 * ring that only works over one of them works over neither in practice.
 */
/** Reads a rule's `opacity` out of components.css, so tonal layers cannot drift. */
function opacityOf(selector: string): number {
  const rule = new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{[^}]*?opacity:\\s*([\\d.]+)`).exec(
    componentsCss,
  );
  if (!rule) throw new Error(`no opacity declared for ${selector} in components.css`);
  return Number(rule[1]);
}

const SURFACES: Record<string, RGB> = {
  'page / card (--bg)': surfaceOf('--bg'),
  'footer (--surface-faint)': surfaceOf('--surface-faint'),
  'section band (--surface)': surfaceOf('--surface'),
  'tinted band (--ob-sky-tint)': surfaceOf('--ob-sky-tint'),
  'НМО note (--warn-wash)': surfaceOf('--warn-wash'),
  'primary button / skip link (--btn-primary-bg)': surfaceOf('--btn-primary-bg'),
  'primary button hover (--btn-primary-bg-hover)': surfaceOf('--btn-primary-bg-hover'),
  'video facade plate (--ink)': surfaceOf('--ink'),
  'video play scrim (--scrim-play over --ink)': surfaceOf('--scrim-play', surfaceOf('--ink')),
  'lightbox scrim over a bright photo': surfaceOf('--scrim-lightbox', WHITE),
  'lightbox scrim over a dark photo': surfaceOf('--scrim-lightbox', BLACK),
  'lightbox pill over a bright photo': surfaceOf('--lightbox-control', WHITE),
  'lightbox pill over a dark photo': surfaceOf('--lightbox-control', BLACK),
  'lightbox pill, hovered, over a bright photo': surfaceOf('--lightbox-control-hover', WHITE),
  'lightbox pill, hovered, over a dark photo': surfaceOf('--lightbox-control-hover', BLACK),
  // The brand pattern. It is `pointer-events: none` and placed in the free strip
  // beside the copy, so nothing focusable is MEANT to land on it — but it bleeds
  // past the band edges at ≥1024, and a ring that failed on it would fail the day
  // a layout shifts by 40px. All three instances: the hero's full-strength one,
  // the hero's tonal second, and the year header's, which is tonal over the sky
  // tint rather than over white.
  'brand pattern, hero instance A (--ob-green)': surfaceOf('--ob-green'),
  'brand pattern, hero instance B (tonal, on white)': over(
    surfaceOf('--ob-green'),
    surfaceOf('--bg'),
    opacityOf('.ob-hero__pattern--b'),
  ),
  'brand pattern, year header (tonal, on --ob-sky-tint)': over(
    surfaceOf('--ob-green'),
    surfaceOf('--ob-sky-tint'),
    opacityOf('.ob-yh__pattern'),
  ),
};

/**
 * NOT in the list, and deliberately: `--ob-sky` (#48A4DB) takes the ring to
 * 2.95:1 and the halo to 2.76:1 — neither rung clears 3:1 on it. The only
 * --ob-sky FIELD on the site is the 3px `--grad-ribbon` strip at the top and
 * bottom of the page, which is decorative and carries no focusable element; the
 * ring's outermost pixel abuts it (skip link at `top: --sp-2` = 8px, ring
 * outer edge 4px, ribbon 0–3px) and never overlaps it. Anything that DOES put
 * an interactive element on a full-strength sky field has to change the ring,
 * not this comment.
 */

const MIN = 3; // SC 1.4.11 floor for a non-text indicator.

describe('focus indicator contrast (WCAG 2.2 SC 1.4.11)', () => {
  const ring = surfaceOf('--focus-ring');
  const halo = surfaceOf('--focus-ring-halo');

  it('is built from two rungs that contrast against EACH OTHER', () => {
    // This is what makes the pair background-independent: whichever rung the
    // surface swallows, the boundary between the two is still ≥3:1, so the
    // indicator has a visible edge even on a surface nobody enumerated.
    expect(contrast(ring, halo)).toBeGreaterThanOrEqual(MIN);
  });

  it.each(Object.entries(SURFACES))('is visible on %s', (_name, surface) => {
    const best = Math.max(contrast(ring, surface), contrast(halo, surface));
    expect(best).toBeGreaterThanOrEqual(MIN);
  });

  /**
   * Asserted as an INVARIANT rather than as one exact string: what has to hold
   * is «halo first, ring behind it, ring thicker», and pinning the literal
   * declaration would fail a harmless reformat while still passing a swap that
   * inverts the two.
   */
  it('paints the halo over the ring, and the ring wider than the halo', () => {
    const layers = token('--focus-shadow')
      .split(',')
      .map((layer) => /0 0 0 (\d+)px var\((--[\w-]+)\)/.exec(layer.trim()));

    expect(layers.every(Boolean), `unparsable --focus-shadow: ${token('--focus-shadow')}`).toBe(
      true,
    );
    const [inner, outer] = layers as RegExpExecArray[];

    // box-shadow paints the first entry on top, so the halo has to come first
    // or the ring is buried under a spread of halo.
    expect(inner[2]).toBe('--focus-ring-halo');
    expect(outer[2]).toBe('--focus-ring');
    // …and the ring has to reach past the halo, or it is fully covered.
    expect(Number(outer[1])).toBeGreaterThan(Number(inner[1]));
    // Both rungs have to be thick enough to read as an indicator at all.
    expect(Number(inner[1])).toBeGreaterThanOrEqual(2);
  });

  /**
   * The cascade guarantee, added after the review of PR #44 found five card
   * components whose `:hover` replaced the whole `box-shadow` and took the ring
   * with it. The fix is structural — the focus rules sit OUTSIDE every cascade
   * layer while the component file sits inside one — so what is asserted is the
   * structure, not the five components that happened to be wrong.
   */
  it('keeps the focus rules out of every cascade layer', () => {
    const layerOpen = baseCss.indexOf('@layer base {');
    const focusRule = baseCss.indexOf(':focus-visible {');
    expect(layerOpen, 'base.css declares no @layer base').toBeGreaterThan(-1);
    // The layer must be closed before the focus rule starts, i.e. the last `}`
    // of the layered block precedes it.
    expect(focusRule).toBeGreaterThan(layerOpen);
    expect(baseCss.slice(layerOpen, focusRule)).toMatch(/\}\s*(\/\*[\s\S]*?\*\/\s*)*$/);
    expect(componentsCss).toMatch(/@layer components \{/);
  });

  /**
   * A component state that paints its own elevation must publish it, or winning
   * the cascade would mean DELETING the hover lift the design asks for. Every
   * `box-shadow` declared on a `:hover`/`:active` in the component layer has to
   * go through `--shadow-state`; the sweep is over the file, so a sixth card is
   * covered the day it is written.
   */
  it('routes every stateful elevation through --shadow-state', () => {
    const offenders = [
      ...componentsCss.matchAll(/([^{}]*:(?:hover|active)[^{}]*)\{([^}]*)\}/g),
    ].filter(([, , body]) => /box-shadow:/.test(body) && !/box-shadow:\s*var\(--shadow-state\)/.test(body))
      .filter(([, , body]) => !/--shadow-state:/.test(body))
      .map(([, selector]) => selector.trim());

    expect(offenders, 'these states paint a shadow without publishing it').toEqual([]);
  });
});

/**
 * Forced colours (Windows High Contrast), found by the audit of PR #44.
 *
 * The whole design above is a `box-shadow`, and forced-colours mode discards
 * box-shadows outright — while the `outline: none` that was written to make room
 * for the ring SURVIVES. The two together leave a keyboard user in HCM with no
 * focus indicator at all, which is the one audience this mode exists for. The
 * mode cannot be exercised by the maths above (the colours are the user's, not
 * ours) and axe cannot see it either, so what is asserted is that the escape
 * hatch is present and restores a real outline.
 */
describe('focus indicator under forced colours', () => {
  /**
   * Tolerates the shapes a formatter may produce — the query may be spelled with
   * or without spaces, the rule may carry other selectors alongside
   * `:focus-visible`, and the declarations may be in any order — while still
   * requiring that the block exists and that `:focus-visible` is one of the
   * things it re-declares.
   */
  const block = /@media[^{]*\(\s*forced-colors\s*:\s*active\s*\)[^{]*\{([\s\S]*?)\n\}/.exec(
    baseCss,
  );

  it('re-declares :focus-visible inside a forced-colors block', () => {
    expect(block, 'base.css has no @media (forced-colors: active) rule').not.toBeNull();
    expect(block![1]).toMatch(/(^|[\s,])(:focus-visible|[\w.[\]='-]+:focus-visible)[\s,{]/);
  });

  it('restores an outline in a system colour, not one of ours', () => {
    const body = block![1];
    // `Highlight` is the palette the USER chose. A token of ours would be either
    // substituted away by the UA or invisible against a palette we cannot see,
    // so the assertion is specifically «a system colour keyword», not «a colour».
    expect(body).toMatch(
      /outline:\s*(?:[\d.]+px\s+solid\s+(Highlight|CanvasText|LinkText|ButtonText)|(Highlight|CanvasText|LinkText|ButtonText)\s+solid\s+[\d.]+px)/,
    );
    // A zero offset would let the outline sit on the glyphs; the box-shadow ring
    // it replaces stood off the element by the width of its halo.
    const offset = /outline-offset:\s*([\d.]+)px/.exec(body);
    expect(offset, 'no outline-offset in the forced-colors block').not.toBeNull();
    expect(Number(offset![1])).toBeGreaterThan(0);
    // The unlayered position matters here too: a layered forced-colours rule
    // would lose to any component `:hover` exactly the way the ring did.
    expect(block!.index).toBeGreaterThan(baseCss.indexOf(':focus-visible {'));
  });
});

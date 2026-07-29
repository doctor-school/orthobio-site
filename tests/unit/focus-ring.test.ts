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
const SURFACES: Record<string, RGB> = {
  'page / card (--bg)': WHITE,
  'footer (--surface-faint)': oklch(0.985, 0.002, 250),
  'section band (--surface)': oklch(0.968, 0.004, 250),
  'tinted band (--ob-sky-tint)': hex('#edf6fc'),
  'НМО note (--warn-wash)': oklch(0.97, 0.02, 80),
  'primary button / skip link (--btn-primary-bg)': hex('#114d9e'),
  'primary button hover (--btn-primary-bg-hover)': hex('#0d3a77'),
  'video facade plate (--ink)': oklch(0.21, 0.02, 250),
  'video play scrim (--scrim-play over --ink)': over(
    oklch(0.35, 0.05, 250),
    oklch(0.21, 0.02, 250),
    0.85,
  ),
  'lightbox scrim over a bright photo': over(oklch(0.17, 0.02, 250), WHITE, 0.93),
  'lightbox scrim over a dark photo': over(oklch(0.17, 0.02, 250), BLACK, 0.93),
  'lightbox pill over a bright photo (--lightbox-control)': over(oklch(0.21, 0.02, 250), WHITE, 0.66),
  'lightbox pill over a dark photo (--lightbox-control)': over(oklch(0.21, 0.02, 250), BLACK, 0.66),
  // The hero/year-header brand pattern. It is `pointer-events: none` and placed
  // in the free strip beside the copy, so nothing focusable is MEANT to land on
  // it — but it bleeds past the band edges at ≥1024, and a ring that failed on
  // it would fail the day a layout shifts by 40px. Both instances: full strength
  // and the 0.5 tonal one.
  'brand pattern (--ob-green)': hex('#70c143'),
  'brand pattern, second instance at 0.5 on white': over(hex('#70c143'), WHITE, 0.5),
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
  const ring = hex(token('--focus-ring'));
  const halo = hex(token('--focus-ring-halo'));

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

  it('paints the halo over the ring, 2px then 4px', () => {
    // Order is load-bearing: box-shadow paints the first entry on top, so the
    // halo has to come first or the ring is buried under a 4px white glow.
    expect(token('--focus-shadow').replace(/\s+/g, ' ')).toBe(
      '0 0 0 2px var(--focus-ring-halo), 0 0 0 4px var(--focus-ring)',
    );
  });
});

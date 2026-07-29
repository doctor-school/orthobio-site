import { test, expect } from '@playwright/test';

/**
 * Brand-identity guards: elements whose ONLY job is to carry the congress
 * palette.
 *
 * They are the site's blind spot. Colour that means «hierarchy» rather than
 * «text» is invisible to axe (decorative, `aria-hidden`), invisible to the
 * overflow and heading guards (its box is unchanged), and invisible to the
 * content specs (it spells nothing). Both identity regressions found so far —
 * the muted hero pattern (#18) and the PartnerTier marker that the design port
 * dropped outright (#27) — were caught by a person looking at the page, long
 * after the merge. This file asserts painted colour, so the next one is caught
 * by CI.
 *
 * The expectation is derived from `tokens.css` AT RUNTIME rather than pinned as
 * an rgb literal: the tier→token map is what the design fixes, and it is pinned
 * as such in tests/unit/partner-tier-markers.test.ts. Re-spelling the hex here
 * would only make a token edit fail in two places and tempt whoever fixes it to
 * paste the new value in without noticing it was a design change.
 */

/** tier → token, the Claude.design bundle's `TIER_DOT` map (see the unit test). */
const TIER_DOT: Record<string, string> = {
  organizer: '--ds-blue-dark',
  'co-organizer': '--ds-blue',
  strategic: '--ob-sky',
  general: '--ob-green',
  partner: '--ob-lime',
  exhibition: '--hairline',
  info: '--hairline',
};

test('every partner tier opens with its marker, in the design’s colour', async ({ page }) => {
  // 2026 is the only roster that carries all seven tiers.
  await page.goto('/archive/2026');

  const painted = await page.evaluate(() => {
    /**
     * Resolve `var(--token)` the way the page itself would: a probe element
     * inside the document, so the value goes through the same cascade and comes
     * back as the computed rgb the browser actually paints. An unknown token
     * leaves the probe transparent — which is exactly the failure being hunted.
     */
    const probe = document.createElement('div');
    document.body.append(probe);
    const resolve = (token: string): string => {
      probe.style.backgroundColor = '';
      probe.style.backgroundColor = `var(${token})`;
      return getComputedStyle(probe).backgroundColor;
    };

    const tiers = [...document.querySelectorAll('.ob-pt')].map((tier) => {
      const dot = tier.querySelector('.ob-pt__dot');
      const heading = tier.querySelector('.ob-pt__title')?.textContent?.trim() ?? '';
      if (!dot) return { heading, tier: null, background: null, size: null, hidden: false };
      const modifier = [...dot.classList].find((c) => c.startsWith('ob-pt__dot--'));
      const box = dot.getBoundingClientRect();
      const style = getComputedStyle(dot);
      return {
        heading,
        tier: modifier?.replace('ob-pt__dot--', '') ?? null,
        background: style.backgroundColor,
        size: { width: box.width, height: box.height, radius: style.borderRadius },
        hidden: dot.getAttribute('aria-hidden') === 'true',
      };
    });

    const resolved = Object.fromEntries(
      ['--ds-blue-dark', '--ds-blue', '--ob-sky', '--ob-green', '--ob-lime', '--hairline'].map(
        (token) => [token, resolve(token)],
      ),
    );
    probe.remove();
    return { tiers, resolved };
  });

  // The sweep is worthless if the page stopped rendering tiers.
  expect(painted.tiers.length, '2026 must render all seven tiers').toBe(7);
  expect([...new Set(painted.tiers.map((t) => t.tier))].sort()).toEqual(
    Object.keys(TIER_DOT).sort(),
  );

  for (const tier of painted.tiers) {
    const token = TIER_DOT[tier.tier ?? ''];
    expect(token, `«${tier.heading}» must carry a known tier marker`).toBeTruthy();
    expect(tier.background, `«${tier.heading}» marker must paint ${token}`).toBe(
      painted.resolved[token],
    );
    // A marker that resolved to nothing would still satisfy a class assertion.
    expect(tier.background, `«${tier.heading}» marker must not be transparent`).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    expect(tier.size?.width, `«${tier.heading}» marker geometry`).toBeCloseTo(9, 0);
    expect(tier.size?.height, `«${tier.heading}» marker geometry`).toBeCloseTo(9, 0);
    // Decoration: the tier is named in the heading beside it, so the marker must
    // add nothing to what a screen reader announces.
    expect(tier.hidden, `«${tier.heading}» marker must be aria-hidden`).toBe(true);
  }

  // The point of the ramp is that it DESCENDS — three distinct congress accents
  // on the paying tiers. A refactor that collapsed them to one colour would
  // satisfy every per-tier assertion above only if the map itself were edited,
  // but a stale token value in tokens.css would not be caught anywhere else.
  const accents = new Set(
    painted.tiers.filter((t) => ['strategic', 'general', 'partner'].includes(t.tier ?? '')).map(
      (t) => t.background,
    ),
  );
  expect(accents.size, 'sky / green / lime must stay three different colours').toBe(3);
});

/**
 * Phone geometry of the marker, on the page that carries the site's longest tier
 * headings: /partners appends the year to every label («Информационные партнёры
 * · 2026» — 336.5px of text).
 *
 * Three things go wrong on a 328px row if the marker is built naively, and all
 * three were seen while building it:
 *
 * • as a flex ITEM of `.ob-pt__h` — the shape the bundle draws — the heading no
 *   longer fits beside it, the row wraps, and the dot is stranded on a line of
 *   its own 28px above the words it marks;
 * • as an IN-FLOW marker inside the heading it eats 19px of the text's own
 *   width, which is more slack than these labels have;
 * • hung too far into the page gutter (16px on a phone) it is clipped by the
 *   screen edge.
 *
 * So: on the first line, inside the viewport, with the count still beside the
 * heading rather than stranded below it. 390 is here as well as 360 because the
 * cliff it guards is 1.5px wide at 390 and does not exist at 360.
 */
for (const width of [360, 390]) {
  test(`the marker holds the heading row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/partners');
    // Every number below is a text measurement, and Inter is self-hosted and
    // wider than the fallback: measured before the font swaps, «Стратегические
    // партнёры · 2026» reads 295.8px instead of 316.6px — enough to fit a row
    // that does not fit in the shipped page.
    await page.evaluate(() => document.fonts.ready);

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.ob-pt__h')].map((header) => {
        const title = header.querySelector('.ob-pt__title');
        const dot = title?.querySelector('.ob-pt__dot');
        const count = header.querySelector('.ob-pt__count');
        const dotBox = dot?.getBoundingClientRect();
        /**
         * The FIRST LINE BOX of the heading text — not the heading's own box.
         * `getClientRects()` on the <h3> is a single border-box rect (it is a
         * block), which a stranded marker would still fall inside; a Range over
         * the text node returns one rect PER LINE, which is the geometry these
         * assertions are actually about.
         */
        const text = [...(title?.childNodes ?? [])].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const lines = text ? [...range.getClientRects()] : [];
        const countBox = count?.getBoundingClientRect();
        return {
          text: text?.textContent?.trim() ?? '',
          dot: dotBox ? { width: dotBox.width, height: dotBox.height, x: dotBox.x } : null,
          dotCentre: dotBox ? dotBox.top + dotBox.height / 2 : null,
          line: lines[0] ? { top: lines[0].top, bottom: lines[0].bottom } : null,
          count: countBox ? { top: countBox.top, bottom: countBox.bottom } : null,
        };
      }),
    );

    expect(rows.length, '/partners must render its 2026 tiers').toBeGreaterThan(3);
    for (const row of rows) {
      const where = `«${row.text}» @${width}`;
      expect(row.dot, `${where}: must carry a marker`).not.toBeNull();
      expect(row.line, `${where}: must have a measurable first line`).not.toBeNull();
      expect(row.dot?.width, `${where}: marker width`).toBeCloseTo(9, 0);
      expect(row.dot?.height, `${where}: marker height`).toBeCloseTo(9, 0);

      // On the first line of the heading — never stranded above it, never
      // drifting to the middle of a label that wrapped.
      expect(row.dotCentre, `${where}: the marker must sit on the first line`).toBeGreaterThan(
        row.line?.top ?? 0,
      );
      expect(row.dotCentre, `${where}: the marker must not float below`).toBeLessThan(
        row.line?.bottom ?? 0,
      );

      // Whole marker inside the viewport: it hangs into the page gutter, and
      // that gutter is only 16px on a phone.
      expect(row.dot?.x, `${where}: the marker must not be clipped by the edge`).toBeGreaterThan(0);

      // The count belongs to the heading, not to a line of its own underneath.
      expect(row.count?.top, `${where}: the count must stay beside the heading`).toBeLessThan(
        row.line?.bottom ?? 0,
      );
      expect(row.count?.bottom, `${where}: the count must stay beside the heading`).toBeGreaterThan(
        row.line?.top ?? 0,
      );
    }
  });
}

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

test('the marker stays on the first line of its heading at 360px', async ({ page }) => {
  /**
   * The narrow-viewport regression this component actually had. /partners
   * appends the year to every tier label, so it carries the longest headings on
   * the site («Информационные партнёры · 2026»); at 360px that heading is 315px
   * wide against 328px of content box. While the marker was a flex ITEM of
   * `.ob-pt__h` — the shape the design bundle draws — the heading no longer fit
   * beside it, `flex-wrap` moved the heading to the next flex line, and the dot
   * was left stranded on a line of its own, 28px above the words it marks.
   * Inline inside the heading it cannot be separated from the text at any
   * width, and this is what proves it.
   */
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/partners');

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.ob-pt__title')].map((title) => {
      const dot = title.querySelector('.ob-pt__dot');
      const dotBox = dot?.getBoundingClientRect();
      /**
       * The FIRST LINE BOX of the heading text — not the heading's own box.
       * `getClientRects()` on the <h3> is a single border-box rect (it is a
       * block), which a stranded marker would still fall inside; a Range over
       * the text node returns one rect PER LINE, which is the geometry the
       * assertion is actually about.
       */
      const text = [...title.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      const range = document.createRange();
      if (text) range.selectNodeContents(text);
      const lines = text ? [...range.getClientRects()] : [];
      return {
        text: title.textContent?.trim() ?? '',
        dot: dotBox ? { width: dotBox.width, height: dotBox.height } : null,
        dotCentre: dotBox ? dotBox.top + dotBox.height / 2 : null,
        lineCount: lines.length,
        line: lines[0] ? { top: lines[0].top, bottom: lines[0].bottom } : null,
      };
    }),
  );

  expect(rows.length, '/partners must render its 2026 tiers').toBeGreaterThan(3);
  for (const row of rows) {
    expect(row.dot, `«${row.text}» must carry a marker`).not.toBeNull();
    expect(row.line, `«${row.text}» must have a measurable first line`).not.toBeNull();
    expect(row.dot?.width, `«${row.text}» marker width at 360px`).toBeCloseTo(9, 0);
    expect(row.dot?.height, `«${row.text}» marker height at 360px`).toBeCloseTo(9, 0);
    expect(
      row.dotCentre,
      `«${row.text}»: the marker must sit on the first line of the heading`,
    ).toBeGreaterThan(row.line?.top ?? 0);
    expect(row.dotCentre, `«${row.text}»: the marker must not float below`).toBeLessThan(
      row.line?.bottom ?? 0,
    );
  }
});

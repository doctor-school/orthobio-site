import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES, YEAR_ROUTES } from './_routes';
import { expectNoOverflow, measureOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';
import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';

/**
 * Parametrised responsive regression over EVERY route × EVERY canonical width,
 * asserting all three AGENTS.md guarantees: zero horizontal page overflow, no
 * heading spill (including a word the browser had to hard-break), no column
 * overlap.
 */
test.describe('responsive', () => {
  for (const path of ROUTES) {
    for (const width of OVERFLOW_WIDTHS) {
      test(`${path} at ${width}px: no overflow`, async ({ page }) => {
        await expectNoOverflow(page, path, width);
      });

      test(`${path} at ${width}px: headings and columns hold`, async ({ page }) => {
        await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
        await page.goto(path);
        await expectNoHeadingSpill(page, `${path} @${width}`);
        await expectNoColumnOverlap(page, `${path} @${width}`);
      });
    }
  }

  // The FAQ answers are the longest running text on the site, and every guard
  // above measures them COLLAPSED — the expanded state was untested (audit
  // observation). Forcing every <details> open re-runs the same three checks
  // plus axe on the state a reader actually sees.
  for (const width of OVERFLOW_WIDTHS) {
    test(`/faq with every answer expanded holds at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/faq');
      await page.evaluate(() => {
        document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
      });
      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
      await expectNoHeadingSpill(page, `/faq expanded @${width}`);
      await expectNoColumnOverlap(page, `/faq expanded @${width}`);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );
      expect(blocking, `axe violations on expanded /faq: ${JSON.stringify(blocking)}`).toEqual([]);
    });
  }

  /**
   * The hero brand pattern is decorative and must stay off the hero copy
   * («не подкладывать под плотный текст»). It regressed the moment the layers
   * went back to the design's saturation (#18): instance B is rotated 150°, so
   * it paints ~2.2× its CSS width, and the strip left free beside the text
   * column is narrower than that from 1024 — where the pattern first appears —
   * until the bundle's own placement fits again at 1280. The a11y suite cannot
   * catch this: the copy stayed above 4.5:1 the whole time.
   *
   * Two questions, deliberately kept apart:
   *
   * - CONTACT — does the artwork actually PAINT under a line of copy? Sampled
   *   with `isPointInFill` against the path itself, so the rotated bounding box
   *   (mostly empty corners) cannot raise a false alarm. Asserted at every
   *   width the pattern exists at, the bundle's 1280+ placements included.
   * - AIR — does the pattern's box crowd the column even where the painted
   *   shape misses it? Only asserted from 1024 to 1279, the band whose
   *   placement is OURS; from 1280 the bundle's geometry overlaps the column by
   *   a few px of empty corner on purpose, and demanding air there would fail
   *   artwork that is visually correct.
   *
   * Both cover BOTH instances: A runs at full opacity and is the louder one.
   */
  const HERO_PATTERNS = ['.ob-hero__pattern--a', '.ob-hero__pattern--b'] as const;

  /**
   * Measures decorative pattern layers against the copy of the band they sit
   * in. Written once and driven by `band` + `selectors` because the year header
   * carries the very same motif under the very same design rule (#38) — a
   * second copy of this probe would be a second place to fix.
   */
  async function probePattern(
    page: Page,
    { path, band, selectors, width }: { path: string; band: string; selectors: readonly string[]; width: number },
  ) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);

    return page.evaluate(({ band, selectors }) => {
      // EVERY text node of the band, not a hand-listed set of tags: the `stats`
      // and `statsNote` slots can render figures as div/span/li, and a selector
      // list would drop them and quietly start measuring less than it claims.
      // Line boxes, not element boxes — a 640px block can have every line end
      // far short of 640px.
      const lines: DOMRect[] = [];
      const walker = document.createTreeWalker(
        document.querySelector(band) as Node,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) lines.push(rect);
        }
      }

      const patterns = selectors.map((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { selector, display: 'ABSENT', pathFound: false, left: 0, hits: 0, samples: 0 };

        const display = getComputedStyle(el).display;
        const box = el.getBoundingClientRect();
        const path = el.querySelector('path');
        let hits = 0;
        let samples = 0;

        // `display:none` yields a null CTM and an all-zero box — hence the
        // explicit display assertion in the tests rather than a 0px reading
        // that would fail with a message pointing nowhere.
        const ctm = display === 'none' || !path ? null : path.getScreenCTM();
        if (path && ctm) {
          const toUser = ctm.inverse();
          const STEP = 4; // px — these shapes are hundreds of px across
          for (const line of lines) {
            const disjoint =
              line.right < box.left ||
              line.left > box.right ||
              line.bottom < box.top ||
              line.top > box.bottom;
            if (disjoint) continue;
            for (let y = line.top; y <= line.bottom; y += STEP) {
              for (let x = line.left; x <= line.right; x += STEP) {
                samples++;
                if (path.isPointInFill(new DOMPoint(x, y).matrixTransform(toUser))) hits++;
              }
            }
          }
        }

        return { selector, display, pathFound: !!path, left: box.left, hits, samples };
      });

      return { textRight: lines.reduce((max, r) => Math.max(max, r.right), 0), patterns };
    }, { band, selectors: selectors as unknown as string[] });
  }

  const probeHeroPattern = (page: Page, width: number) =>
    probePattern(page, { path: '/', band: '.ob-hero', selectors: HERO_PATTERNS, width });

  for (const width of [1024, 1120, 1279, 1280, 1440]) {
    test(`no hero pattern paints under the hero copy at ${width}px`, async ({ page }) => {
      const { textRight, patterns } = await probeHeroPattern(page, width);
      expect(textRight).toBeGreaterThan(0);

      for (const p of patterns) {
        // Hiding the pattern is what the WRONG fix for #18 looks like, so it
        // fails here instead of trivially satisfying a clearance check.
        expect(p.display, `${p.selector} is "${p.display}" at ${width}px, expected block`).toBe(
          'block',
        );
        expect(p.pathFound, `${p.selector} has no <path> — the probe measured nothing`).toBe(true);
        expect(
          p.hits,
          `${p.selector} paints over ${p.hits} of ${p.samples} points sampled inside hero ` +
            `line boxes at ${width}px — decorative artwork is sitting under the copy`,
        ).toBe(0);
      }
    });
  }

  for (const width of [1024, 1120, 1279]) {
    test(`the hero pattern leaves the copy air at ${width}px`, async ({ page }) => {
      const { textRight, patterns } = await probeHeroPattern(page, width);

      for (const p of patterns) {
        expect(p.display, `${p.selector} is "${p.display}" at ${width}px, expected block`).toBe(
          'block',
        );
        expect(
          p.left,
          `${p.selector} starts at ${Math.round(p.left)}px while the widest line of hero copy ` +
            `ends at ${Math.round(textRight)}px — the decorative layer is crowding the text ` +
            `column at ${width}px`,
        ).toBeGreaterThanOrEqual(textRight);
      }
    });
  }

  /**
   * The year header carries the same metaball motif, and the same rule applies
   * to it (#38): decorative artwork must not sit under the header copy. It got
   * there by a different route than the hero's — the layer is anchored to the
   * viewport's right edge (`right: -80px; width: 280px`, the design's own
   * placement), so the strip it occupies is «viewport − 200px» and eats into
   * the text column as soon as the window is narrow: at 360px it started at
   * 160px while the copy ran to 328px — 168px of the year number, the H1 and
   * the dates painted over.
   *
   * EVERY year route, not the one page a screenshot was taken of: the header is
   * one template over per-year content, and the length of its copy is the whole
   * question. 2026 proved it — its venue line («…отель „Холидей Инн Москва
   * Сокольники“ (Русаковская ул., 24…») runs 300px longer than 2025's date line
   * and walked straight into the layer at 1024 while 2025 was clean. A guard
   * pinned to one year would have kept passing.
   *
   * Below 1024 the assertion is «hidden OR clear», not «hidden»: the guard
   * exists to protect the copy, and a future placement that keeps the motif on
   * a phone with real air is a legitimate way to satisfy it. At 1024 and up the
   * layer must be THERE and clear — otherwise deleting the decoration outright
   * would pass this suite.
   */
  for (const path of YEAR_ROUTES) {
    for (const width of OVERFLOW_WIDTHS) {
      test(`the year header pattern stays off the copy of ${path} at ${width}px`, async ({
        page,
      }) => {
        const { textRight, patterns } = await probePattern(page, {
          path,
          band: '.ob-yh',
          selectors: ['.ob-yh__pattern'],
          width,
        });
        expect(textRight).toBeGreaterThan(0);
        const [p] = patterns;

        if (width >= 1024) {
          expect(
            p.display,
            `${p.selector} is "${p.display}" at ${width}px — the year header must keep the brand ` +
              `motif at the widths that have room for it`,
          ).toBe('block');
          expect(p.pathFound, `${p.selector} has no <path> — the probe measured nothing`).toBe(
            true,
          );
        }

        if (p.display === 'none') return;

        expect(
          p.hits,
          `${p.selector} paints over ${p.hits} of ${p.samples} points sampled inside the ` +
            `${path} header's line boxes at ${width}px — decorative artwork is sitting under ` +
            `the copy`,
        ).toBe(0);
        expect(
          p.left,
          `${p.selector} starts at ${Math.round(p.left)}px while the widest line of the ${path} ` +
            `header ends at ${Math.round(textRight)}px — the decorative layer is crowding the ` +
            `text column at ${width}px`,
        ).toBeGreaterThanOrEqual(textRight);
      });
    }
  }

  // Same blind spot on the year page: every guard above measures the gallery
  // CLOSED, and a `:target` lightbox exists only while the fragment points at
  // it — so the state a reader actually looks at was untested.
  for (const width of OVERFLOW_WIDTHS) {
    test(`the open photo lightbox holds at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/archive/2022#pg2022-1');
      await expect(page.locator('#pg2022-1')).toBeVisible();
      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
      await expectNoColumnOverlap(page, `lightbox @${width}`);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );
      expect(blocking, `axe violations on the open lightbox: ${JSON.stringify(blocking)}`).toEqual(
        [],
      );
    });
  }
});

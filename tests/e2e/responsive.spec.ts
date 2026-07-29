import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES } from './_routes';
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
   * («не подкладывать под плотный текст»). It regressed exactly once the layers
   * went back to the design's saturation (PR #26): instance B is rotated 150°,
   * so it paints ~2.2× its CSS width, and between 1024 — where the pattern
   * first appears — and 1279 that box is wider than the free strip beside the
   * text column. A geometry check, because the a11y suite cannot catch this:
   * the text stayed above 4.5:1 the whole time.
   *
   * Scoped to the band whose placement is ours. From 1280 the geometry is the
   * design bundle's own, and its rotated BOUNDING BOX does clip the text column
   * by a few px while the painted shape clears it — an assertion on the box
   * would fail on artwork that is visually correct.
   */
  for (const width of [1024, 1120, 1279]) {
    test(`the hero pattern clears the hero copy at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');

      const { patternLeft, textRight } = await page.evaluate(() => {
        const pattern = document.querySelector('.ob-hero__pattern--b');
        const left = pattern ? pattern.getBoundingClientRect().left : Number.POSITIVE_INFINITY;
        // Line boxes, not element boxes: a block can be 640px wide with every
        // line ending far short of that.
        let right = 0;
        for (const node of document.querySelectorAll('.ob-hero p, .ob-hero h1, .ob-hero a')) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0) right = Math.max(right, rect.right);
          }
        }
        return { patternLeft: left, textRight: right };
      });

      expect(textRight).toBeGreaterThan(0);
      expect(
        patternLeft,
        `the hero pattern starts at ${Math.round(patternLeft)}px and the widest ` +
          `line of hero copy ends at ${Math.round(textRight)}px — the decorative ` +
          `layer is sitting under the text at ${width}px`,
      ).toBeGreaterThanOrEqual(textRight);
    });
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

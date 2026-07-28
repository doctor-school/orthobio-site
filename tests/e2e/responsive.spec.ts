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

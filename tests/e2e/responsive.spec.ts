import { test } from '@playwright/test';
import { ROUTES } from './_routes';
import { expectNoOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';
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
});

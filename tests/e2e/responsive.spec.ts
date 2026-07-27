import { test } from '@playwright/test';
import { ROUTES } from './_routes';
import { expectNoOverflow, OVERFLOW_WIDTHS } from './_overflow';

/**
 * Parametrised responsive regression: EVERY route × EVERY canonical width must
 * have zero horizontal page overflow (AGENTS.md testing expectations).
 */
test.describe('responsive: no horizontal overflow', () => {
  for (const path of ROUTES) {
    for (const width of OVERFLOW_WIDTHS) {
      test(`${path} at ${width}px`, async ({ page }) => {
        await expectNoOverflow(page, path, width);
      });
    }
  }
});

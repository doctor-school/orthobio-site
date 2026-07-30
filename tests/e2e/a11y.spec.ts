import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES } from './_routes';

/**
 * Accessibility gate: axe (WCAG 2 A/AA) on every route, plus the impact-agnostic
 * `heading-order` check — heading-order violations are only MODERATE impact, so
 * the critical/serious filter alone would never catch a broken outline
 * (donor lesson, bbm#83).
 */

/**
 * Axe runs at EVERY tier of the ladder, not at Playwright's default viewport:
 * the site swaps layouts by media query, so a single-viewport run leaves whole
 * layouts unaudited. The 1024 tier is the concrete lesson — the hero brand
 * pattern only exists from 1024 up and is placed differently until 1280, and a
 * default-viewport axe run could never have seen either state (audit of PR #26).
 * 390 is left out: for axe it renders the same layout as 360.
 *
 * These widths are NOT reduced by the classic-scrollbar gutter the way
 * `_overflow` reduces its own. That reduction exists to make a page reflow into
 * the width a real user has; here the width IS the subject, and a nominal 1024
 * minus the gutter would select the sub-1024 layout instead of the one meant to
 * be audited.
 */
const AXE_WIDTHS = [360, 768, 1024, 1280] as const;
test('the skip link is the first tab stop and jumps to the content', async ({ page }) => {
  // The persistent site chrome precedes every page. The link gives keyboard
  // users a direct route to the content regardless of the active nav layout.
  await page.goto('/archive/2025');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('href', '#main');
  await expect(focused).toBeVisible();
  await expect(page.locator('main#main')).toBeAttached();
});

test.describe('a11y: axe per route', () => {
  for (const path of ROUTES) {
    for (const width of AXE_WIDTHS) {
      test(`${path} at ${width}px has no critical/serious violations`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const blocking = results.violations.filter((v) =>
          ['critical', 'serious'].includes(v.impact ?? ''),
        );
        expect(
          blocking,
          `axe violations on ${path} at ${width}px: ${JSON.stringify(
            blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })),
            null,
            2,
          )}`,
        ).toEqual([]);
      });
    }

    // Not parametrised by width: the outline is a property of the DOM, and no
    // media query on this site adds, removes or reorders a heading.
    test(`${path} has a clean heading order`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
      expect(
        results.violations,
        `axe heading-order violations on ${path}: ${JSON.stringify(
          results.violations.map((v) => v.nodes.map((n) => n.html)),
          null,
          2,
        )}`,
      ).toEqual([]);
    });
  }
});

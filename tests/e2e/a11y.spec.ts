import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES } from './_routes';

/**
 * Accessibility gate: axe (WCAG 2 A/AA) on every route, plus the impact-agnostic
 * `heading-order` check — heading-order violations are only MODERATE impact, so
 * the critical/serious filter alone would never catch a broken outline
 * (donor lesson, bbm#83).
 */
test('the skip link is the first tab stop and jumps to the content', async ({ page }) => {
  // The primary nav is 8 wrapping items on every page; without this, a keyboard
  // user walks all of them before reaching the content on every navigation.
  await page.goto('/archive/2025');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('href', '#main');
  await expect(focused).toBeVisible();
  await expect(page.locator('main#main')).toBeAttached();
});

test.describe('a11y: axe per route', () => {
  for (const path of ROUTES) {
    test(`${path} has no critical/serious violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );
      expect(
        blocking,
        `axe violations on ${path}: ${JSON.stringify(
          blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })),
          null,
          2,
        )}`,
      ).toEqual([]);
    });

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

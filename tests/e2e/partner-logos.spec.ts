import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Partner logos rest in grayscale and regain colour on hover and on keyboard
 * focus (Issue #101); on a device without hover they are in colour at rest.
 *
 * One tier is enough: every tier is the same `PartnerTier` component. The card
 * under test is the first LINKED card with a logo on /partners, because only a
 * link is keyboard-focusable — a static plate could not prove the focus half.
 *
 * Assertions read `filter` through `toHaveCSS`, which retries: during the
 * 130ms transition `getComputedStyle` reports the interpolated value, so a
 * single read right after hover would race it.
 */

async function openPartners(page: Page): Promise<{ card: Locator; img: Locator }> {
  await page.goto('/partners');
  const card = page.locator('.ob-pt a.ob-pt__card:has(img)').first();
  const img = card.locator('img');
  await card.scrollIntoViewIfNeeded();
  await expect(img).toBeVisible();
  return { card, img };
}

const WAYS_TO_COLOUR = [
  {
    name: 'hover',
    act: async (_page: Page, card: Locator) => {
      await card.hover();
    },
  },
  {
    name: 'keyboard focus',
    act: async (page: Page, card: Locator) => {
      // A real Tab onto the card, not only a programmatic focus: the rule keys
      // on `:focus-visible`, and keyboard navigation is what sets it.
      await card.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(card).not.toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card).toBeFocused();
    },
  },
] as const;

test.describe('partner logos: grayscale at rest, colour on interaction', () => {
  for (const way of WAYS_TO_COLOUR) {
    test(`a linked logo regains colour on ${way.name}`, async ({ page }) => {
      const { card, img } = await openPartners(page);
      await expect(img, 'logo must rest in grayscale').toHaveCSS('filter', 'grayscale(1)');
      await way.act(page, card);
      await expect(img, `logo must be in colour on ${way.name}`).toHaveCSS('filter', 'none');
    });
  }
});

test.describe('partner logos on a device without hover', () => {
  // `isMobile` makes Chromium report `(hover: none)`: nothing could ever lift a
  // grey rest there, so the logo must be in colour from the start.
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a logo is in colour at rest', async ({ page }) => {
    const { img } = await openPartners(page);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    await expect(img).toHaveCSS('filter', 'none');
  });
});

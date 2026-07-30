import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { measureOverflow } from './_overflow';

const MOBILE_WIDTHS = [360, 390, 768] as const;

test.describe('primary navigation', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`the mobile menu owns navigation at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/archive/');

      const desktopNav = page.locator('.ob-nav');
      const menu = page.locator('details.ob-menu');
      const trigger = menu.locator('summary');
      const panel = menu.locator('.ob-menu__panel');

      await expect(desktopNav).toBeHidden();
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAccessibleName('Меню');
      await expect(trigger).toHaveCSS('cursor', 'pointer');

      const target = await trigger.boundingBox();
      expect(target, 'the menu trigger must have a painted box').not.toBeNull();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);

      await expect(panel).toBeHidden();
      await expect(menu.locator('.ob-menu__icon--menu')).toBeVisible();
      await expect(menu.locator('.ob-menu__icon--close')).toBeHidden();

      await trigger.focus();
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');

      await expect(menu).toHaveAttribute('open', '');
      await expect(panel).toBeVisible();
      await expect(menu.locator('.ob-menu__icon--menu')).toBeHidden();
      await expect(menu.locator('.ob-menu__icon--close')).toBeVisible();
      await expect(panel.locator('a')).toHaveCount(8);
      await expect(panel.locator('a[aria-current="page"]')).toHaveText('Архив');
      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      );
      expect(blocking, `axe violations in the open menu: ${JSON.stringify(blocking)}`).toEqual([]);

      await panel.getByRole('link', { name: 'FAQ' }).click();
      await expect(page).toHaveURL(/\/faq$/);
    });
  }

  test('desktop navigation takes over at lg', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');

    await expect(page.locator('.ob-nav')).toBeVisible();
    await expect(page.locator('details.ob-menu')).toBeHidden();
  });
});

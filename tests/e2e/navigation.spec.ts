import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { waitForWebfonts } from './_fonts';
import { measureOverflow, SCROLLBAR_GUTTER } from './_overflow';

const MOBILE_WIDTHS = [360, 390, 768] as const;

// NOMINAL window widths, deliberately without the scrollbar gutter that
// `_overflow.ts` subtracts: the ladder there puts «1024» at 1007px, below the
// `lg` breakpoint, where this menu is hidden. The range that carries nine items
// at the tight padding (`--nav-link-pad-tight`, Issue #122) is 1024–1279, and
// only a test that really stands in it protects it.
const DESKTOP_WIDTHS = [1024, 1100, 1279, 1280] as const;
const DESKTOP_ROUTES = ['/', '/consensus/'] as const;

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
      await expect(panel.locator('a')).toHaveCount(9);
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

  for (const route of DESKTOP_ROUTES) {
    for (const width of DESKTOP_WIDTHS) {
      test(`all nine items fit the header on ${route} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await waitForWebfonts(page);

        const nav = page.locator('.ob-nav');
        await expect(nav).toBeVisible();
        const links = nav.locator('a');
        await expect(links).toHaveCount(9);

        const geometry = await page.evaluate(() => {
          const rect = (selector: string) => {
            const box = document.querySelector(selector)!.getBoundingClientRect();
            return { left: box.left, right: box.right };
          };
          const head = document.querySelector('.ob-head__in')!;
          const headStyle = getComputedStyle(head);
          const headBox = head.getBoundingClientRect();
          return {
            nav: rect('.ob-nav'),
            logo: rect('.ob-head__logo'),
            contentRight: headBox.right - Number.parseFloat(headStyle.paddingRight),
            tops: [...document.querySelectorAll('.ob-nav a')].map((a) =>
              Math.round(a.getBoundingClientRect().top),
            ),
          };
        });

        expect(
          new Set(geometry.tops).size,
          `nav links wrap onto several rows: tops ${geometry.tops.join(', ')}`,
        ).toBe(1);
        expect(
          geometry.nav.right,
          `the nav sticks out past the header content box by ${geometry.nav.right - geometry.contentRight}px`,
        ).toBeLessThanOrEqual(geometry.contentRight + 0.5);
        // The logo has `margin-right: auto` in a flex row with a 16px gap, so the
        // gap itself survives even when the nav overflows and a bare `>= 16` can
        // never fail. The slack beyond it is what a classic scrollbar eats
        // (a 1024px window lays out at 1007px), so require that much in reserve.
        expect(
          geometry.nav.left - geometry.logo.right,
          'the nav would be pressed against the logo under a classic scrollbar',
        ).toBeGreaterThanOrEqual(16 + SCROLLBAR_GUTTER);
        expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }

  test('desktop navigation takes over at lg', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');

    await expect(page.locator('.ob-nav')).toBeVisible();
    await expect(page.locator('details.ob-menu')).toBeHidden();
  });
});

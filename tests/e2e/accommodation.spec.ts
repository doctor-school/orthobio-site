import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { waitForWebfonts } from './_fonts';
import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';
import { expectNoOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';

/**
 * «Проживание» on /participants (Issue #112). The route-wide sweeps already
 * cover the page; this spec pins what only this section can break:
 *
 * - the promo code is ONE unbreakable token (`white-space: nowrap`) sized by
 *   its card in container units — if the sizing regresses it clips inside the
 *   card instead of overflowing the page, which the page-level overflow check
 *   cannot see. Measured on the element itself: scrollWidth ≤ clientWidth.
 * - axe scoped to the section, at every tier, so a violation inside it is
 *   reported against it rather than lost in a page-wide list.
 */
const SECTION = '#accommodation';

test.describe('accommodation section', () => {
  for (const width of OVERFLOW_WIDTHS) {
    test(`/participants at ${width}px: no page overflow`, async ({ page }) => {
      await expectNoOverflow(page, '/participants', width);
      await expect(page.locator(SECTION)).toBeVisible();
    });

    test(`the promo code fits its card on one line at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/participants');
      await waitForWebfonts(page);

      const code = page.locator(`${SECTION} .ob-acc__code`);
      await expect(code).toHaveText('ОРТОБИОЛОГИЯ');
      const m = await code.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          scroll: el.scrollWidth,
          client: el.clientWidth,
          lines: range.getClientRects().length,
        };
      });
      expect(m.scroll, `promo code overflows its card: ${JSON.stringify(m)}`).toBeLessThanOrEqual(
        m.client,
      );
      expect(m.lines, 'promo code must stay on one line').toBe(1);
    });

    test(`headings and columns hold inside the section at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/participants');
      await expectNoHeadingSpill(page, `/participants#accommodation @${width}`);
      await expectNoColumnOverlap(page, `/participants#accommodation @${width}`);
    });

    test(`axe finds nothing critical or serious in the section at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/participants');
      const results = await new AxeBuilder({ page })
        .include(SECTION)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }

  // A wrapping label once left the ↗ icon alone at the far edge of the
  // full-width CTA and of the address row (orchestrator review, PR #113): the
  // icon must sit right after the last word, on the same line.
  for (const width of [360, 1280]) {
    test(`external-link icons stay glued to their text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/participants');
      await waitForWebfonts(page);

      const icons = page.locator(`${SECTION} .ob-acc__ext`);
      await expect(icons).toHaveCount(2);
      for (const icon of await icons.all()) {
        const m = await icon.evaluate((svg) => {
          const text = svg.previousSibling;
          if (!text) return null;
          const range = document.createRange();
          range.selectNodeContents(text);
          const rects = [...range.getClientRects()];
          const end = rects[rects.length - 1];
          const box = svg.getBoundingClientRect();
          const mid = box.top + box.height / 2;
          return {
            gap: box.left - end.right,
            sameLine: mid >= end.top && mid <= end.bottom,
          };
        });
        expect(m, 'the icon must follow a text node').not.toBeNull();
        expect(m!.gap, `icon drifts from its text: ${JSON.stringify(m)}`).toBeLessThanOrEqual(8);
        expect(m!.gap).toBeGreaterThanOrEqual(0);
        expect(m!.sameLine, 'icon must sit on the last line of its text').toBe(true);
      }
    });
  }

  test('the screenshot is lazy, sized and served from our bucket', async ({ page }) => {
    await page.goto('/participants');
    const img = page.locator(`${SECTION} .ob-acc__frame img`);
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveAttribute('width', '560');
    await expect(img).toHaveAttribute('height', '257');
    await expect(img).toHaveAttribute(
      'src',
      'https://s3.twcstorage.ru/orthobio-media/2027/accommodation/hotel-promo-field.png',
    );
  });

  test('the /registration venue card links into the section', async ({ page }) => {
    await page.goto('/registration');
    const link = page.getByRole('link', { name: 'Проживание по промокоду' });
    await expect(link).toHaveAttribute('href', '/participants#accommodation');
    await expect(link).not.toHaveAttribute('target', /.*/);
    await link.click();
    await expect(page).toHaveURL(/\/participants#accommodation$/);
    await expect(page.locator(SECTION)).toBeInViewport();
  });
});

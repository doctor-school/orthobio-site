import { test, expect } from '@playwright/test';
import { measureOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';
import { expectNoColumnOverlap } from './_layout';

/**
 * Click-to-load video facade (design brief §3.5, Issue #19).
 *
 * The provider is stubbed: what is under test is our swap — that the click
 * yields an in-page frame pointed at the right video and never a navigation —
 * and a suite that depends on Rutube being reachable would fail for reasons
 * that have nothing to do with this repo.
 */
const stubProvider = async (page: import('@playwright/test').Page) => {
  await page.route('https://rutube.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub' }),
  );
};

test('a Rutube card loads the player in place, without leaving the page', async ({ page }) => {
  await stubProvider(page);
  await page.goto('/archive/2025');

  const facade = page.locator('button[data-ob-video]').first();
  await expect(facade).toHaveAccessibleName(/Смотреть на странице/);
  // Nothing embedded before the click: eight frames on a year page is the cost
  // the facade exists to avoid.
  await expect(page.locator('iframe')).toHaveCount(0);

  await facade.click();

  const frame = page.locator('iframe.ob-vc__frame');
  await expect(frame).toHaveAttribute(
    'src',
    'https://rutube.ru/play/embed/15094348253029651341d677331f4515/?autoplay=true',
  );
  // A frame without a name is an unlabelled region for a screen reader.
  await expect(frame).toHaveAttribute('title', /\S/);
  expect(page.url()).toContain('/archive/2025');
  // The sibling cards are untouched: one click loads one player.
  await expect(page.locator('button[data-ob-video]')).toHaveCount(2);
});

test('the facade is keyboard-operable and keeps focus in the player', async ({ page }) => {
  await stubProvider(page);
  await page.goto('/archive/2025');

  const facade = page.locator('button[data-ob-video]').first();
  await facade.focus();
  await expect(facade).toBeFocused();
  await page.keyboard.press('Enter');

  const frame = page.locator('iframe.ob-vc__frame');
  await expect(frame).toBeAttached();
  // The activated element is gone; without an explicit move, focus falls back
  // to <body> and a keyboard user restarts at the top of the document.
  await expect(frame).toBeFocused();
});

/**
 * The activated card is novel geometry: every other guard in the suite measures
 * /archive/2025 in its facade (pre-click) state, so the frame that replaces the
 * facade had no per-breakpoint regression at all. A 16/9 box dropped into a
 * grid column is exactly the shape that overflows a 360px phone.
 */
test.describe('the loaded player holds the layout', () => {
  for (const width of OVERFLOW_WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      await stubProvider(page);
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/archive/2025');

      const before = await measureOverflow(page);
      expect(before, `/archive/2025 already overflows at ${width}px`).toBeLessThanOrEqual(0);

      await page.locator('button[data-ob-video]').first().click();
      const frame = page.locator('iframe.ob-vc__frame');
      await expect(frame).toBeVisible();

      const box = await frame.boundingBox();
      expect(box, 'the loaded frame must have a box').not.toBeNull();
      // The facade reserves 16/9 and the frame must inherit it — a frame that
      // collapses or grows past its column is a layout shift, not a player.
      expect(box!.width / box!.height, `frame aspect ratio at ${width}px`).toBeCloseTo(16 / 9, 2);

      const after = await measureOverflow(page);
      expect(
        after,
        `the loaded player overflows the usable width ${width - SCROLLBAR_GUTTER}px by ${after}px`,
      ).toBeLessThanOrEqual(0);
      await expectNoColumnOverlap(page, `loaded player @${width}`);
    });
  }
});

test('a YouTube card stays an outbound link and says so', async ({ page }) => {
  // 20 of 23 archive videos are YouTube-hosted, which the RF cannot rely on —
  // those cards must not pretend to embed.
  await page.goto('/archive/2021');
  await expect(page.locator('button[data-ob-video]')).toHaveCount(0);

  const card = page.locator('a.ob-vc').first();
  await expect(card).toHaveAttribute('href', /youtube\.com|youtu\.be/);
  await expect(card).toHaveAttribute('target', '_blank');
  await expect(card).toHaveAttribute('rel', /noopener/);
  await expect(card.locator('.ob-vc__ext')).toHaveText(/новой вкладке/);
});

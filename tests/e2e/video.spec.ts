import { test, expect, type Page } from '@playwright/test';
import { measureOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';
import { expectNoColumnOverlap } from './_layout';

/**
 * Click-to-load video facade (design brief §3.5, Issue #19).
 *
 * The provider is stubbed: what is under test is our swap — that the click
 * yields an in-page frame pointed at the right video and never a navigation —
 * and a suite that depends on Rutube being reachable would fail for reasons
 * that have nothing to do with this repo. The stub is installed on the CONTEXT,
 * not the page, so a modified click that opens a second tab is covered too.
 */
const WATCH_URL = 'https://rutube.ru/video/15094348253029651341d677331f4515/';
const EMBED_URL = 'https://rutube.ru/play/embed/15094348253029651341d677331f4515/?autoplay=true';

const stubProvider = (page: Page) =>
  page
    .context()
    .route('https://rutube.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub' }),
    );

test('a Rutube card loads the player in place, without leaving the page', async ({ page }) => {
  await stubProvider(page);
  await page.goto('/archive/2025');

  const facade = page.locator('a[data-ob-video]').first();
  // The name is the card's own text; nothing about it is authored.
  await expect(facade).toHaveAccessibleName(/Отчетный ролик конгресса 2025/);
  // Nothing embedded before the click: eight frames on a year page is the cost
  // the facade exists to avoid.
  await expect(page.locator('iframe')).toHaveCount(0);

  await facade.click();

  const frame = page.locator('iframe.ob-vc__frame');
  await expect(frame).toHaveAttribute('src', EMBED_URL);
  // A frame without a name is an unlabelled region for a screen reader.
  await expect(frame).toHaveAttribute('title', /\S/);
  expect(page.url()).toContain('/archive/2025');
  // The sibling cards are untouched: one click loads one player.
  await expect(page.locator('a[data-ob-video]')).toHaveCount(2);
  // The caption survives the swap — it is moved, not re-rendered.
  await expect(page.locator('.ob-vc__frame + .ob-vc__title')).toHaveText(
    /Отчетный ролик конгресса 2025/,
  );
});

test('the facade is keyboard-operable and keeps focus in the player', async ({ page }) => {
  await stubProvider(page);
  await page.goto('/archive/2025');

  const facade = page.locator('a[data-ob-video]').first();
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
 * Progressive enhancement is the whole point of the anchor: the island may not
 * run (a proxy that strips `type="module"`, an extension, a future
 * `script-src 'self'` CSP), and the video must still be reachable when it does
 * not. This is the regression for the review finding on PR #30.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the card is still a working link to the video', async ({ page }) => {
    await stubProvider(page);
    await page.goto('/archive/2025');

    const card = page.locator('a[data-ob-video]').first();
    await expect(card).toHaveAttribute('href', WATCH_URL);
    await expect(card).toBeVisible();
    // Nothing was swapped in, and nothing pretends it was.
    await expect(page.locator('iframe')).toHaveCount(0);
    // Every video on the page is reachable, not just the first.
    await expect(page.locator('a.ob-vc[href^="https://rutube.ru/video/"]')).toHaveCount(3);

    // «Has an href» is not the claim; «the visitor gets to the video» is.
    await card.click();
    await page.waitForURL(WATCH_URL);
    expect(page.url()).toBe(WATCH_URL);
  });
});

test('a modified click is left to the browser, not swallowed by the island', async ({ page }) => {
  // Ctrl-click, ⌘-click and middle-click are how a physician opens the video in
  // a background tab; an unguarded preventDefault() kills all three silently.
  await stubProvider(page);
  await page.goto('/archive/2025');

  const card = page.locator('a[data-ob-video]').first();
  await card.click({ modifiers: ['ControlOrMeta'] });

  await expect(page.locator('iframe.ob-vc__frame')).toHaveCount(0);
  await expect(page.locator('a[data-ob-video]')).toHaveCount(3);
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

      await page.locator('a[data-ob-video]').first().click();
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
  await expect(page.locator('a[data-ob-video]')).toHaveCount(0);

  const card = page.locator('a.ob-vc').first();
  await expect(card).toHaveAttribute('href', /youtube\.com|youtu\.be/);
  await expect(card).toHaveAttribute('target', '_blank');
  await expect(card).toHaveAttribute('rel', /noopener/);
  await expect(card.locator('.ob-vc__ext')).toHaveText(/новой вкладке/);
});

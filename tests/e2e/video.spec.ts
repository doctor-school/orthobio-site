import { test, expect } from '@playwright/test';

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

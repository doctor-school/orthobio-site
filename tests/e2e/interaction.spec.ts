import { test, expect } from '@playwright/test';
import { ROUTES } from './_routes';

/**
 * Interaction guards (Issue #20).
 *
 * Two classes of defect this file exists to stop coming back:
 * • a link that leaves the site opening IN PLACE, dropping the reader out of
 *   the congress site and into a PDF viewer or a video host with no way back;
 * • a clickable element with no visible pointer feedback — and its mirror, an
 *   element that LOOKS clickable and is not.
 *
 * State assertions go through `toHaveCSS`, never a one-shot `evaluate`: every
 * `.ob-*` state is a 130ms transition (`--t-state`), so a computed value read
 * on the frame right after `hover()` is still the resting one. `toHaveCSS`
 * retries until the transition settles; a bare read reports «no hover» for a
 * hover that works.
 */

/** Absolute http(s) links to some other host — the ones that need a new tab. */
const EXTERNAL_LINKS = `a[href^="http"]:not([href*="localhost"])`;

test('every external link opens in a new tab, safely', async ({ page }) => {
  let checked = 0;

  for (const path of ROUTES) {
    await page.goto(path);
    const links = page.locator(EXTERNAL_LINKS);

    for (const link of await links.all()) {
      const href = await link.getAttribute('href');
      // `noopener` severs `window.opener`, so the opened host cannot navigate
      // the tab it came from.
      await expect(link, `${path} → ${href} must open in a new tab`).toHaveAttribute(
        'target',
        '_blank',
      );
      await expect(link, `${path} → ${href} must carry rel=noopener`).toHaveAttribute(
        'rel',
        /noopener/,
      );
      checked += 1;
    }
  }

  // The guard is worthless if a refactor quietly empties the roster of external
  // links it walks: the loop above would pass over nothing and stay green.
  expect(checked, 'the sweep must find external links to check').toBeGreaterThan(10);
});

test('links that stay on the site — and mailto — keep the current tab', async ({ page }) => {
  for (const path of ['/', '/archive/', '/contacts', '/faq']) {
    await page.goto(path);
    // `mailto:`/`tel:` hand off to another application; a target there opens a
    // blank tab next to the mail client and leaves it stranded.
    const internal = page.locator('a[href^="/"], a[href^="mailto:"], a[href^="tel:"], a[href^="#"]');
    for (const link of await internal.all()) {
      const href = await link.getAttribute('href');
      expect(await link.getAttribute('target'), `${path} → ${href} must stay in place`).toBeNull();
    }
  }
});

test('a photo tile answers the pointer (owner report: it did not)', async ({ page }) => {
  await page.goto('/archive/2025');
  const tile = page.locator('a.ob-pg__it').first();

  // The tile is a lightbox trigger, not a navigation — `zoom-in` says so.
  await expect(tile).toHaveCSS('cursor', 'zoom-in');

  const photo = tile.locator('img');
  await expect(photo).toHaveCSS('scale', 'none');
  await tile.hover();
  // The previous hover was a drop shadow behind an image that covers the whole
  // tile at the same radius — invisible. The feedback has to happen on the
  // pixels the pointer is over.
  await expect(photo).toHaveCSS('scale', '1.05');
});

test('a partner without a site does not pretend to be clickable', async ({ page }) => {
  await page.goto('/archive/2025');
  const linked = page.locator('a.ob-pt__card').first();
  const static_ = page.locator('span.ob-pt__card--static').first();
  await expect(linked).toBeVisible();
  await expect(static_).toBeVisible();

  await expect(linked).toHaveCSS('cursor', 'pointer');
  await expect(static_).toHaveCSS('cursor', 'default');

  // Distinguishable at REST, before anyone hovers anything: the linked card is
  // an outlined white card, the roster entry a filled borderless plate.
  const [linkedBg, staticBg] = await Promise.all([
    linked.evaluate((el) => getComputedStyle(el).backgroundColor),
    static_.evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(staticBg, 'the static entry must not share the card fill').not.toBe(linkedBg);

  // …and the hover lift belongs to the link alone.
  const staticShadowAtRest = await static_.evaluate((el) => getComputedStyle(el).boxShadow);
  await linked.hover();
  await expect(linked).not.toHaveCSS('box-shadow', 'none');
  await static_.hover();
  await expect(static_).toHaveCSS('box-shadow', staticShadowAtRest);
});

test('the anchor offset exists only where the header is sticky', async ({ page }) => {
  const target = page.locator('[id]').first();

  // Below lg the header scrolls away with the page, so an 88px offset would
  // park every anchor that far past its own heading.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/archive/2025');
  await expect(target).toHaveCSS('scroll-margin-top', '0px');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/archive/2025');
  await expect(target).toHaveCSS('scroll-margin-top', '88px');
});

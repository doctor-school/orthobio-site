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

/**
 * The canonical origin — `site` in astro.config.mjs. Mirrors the comparison
 * `PartnerTier` makes against `Astro.site`.
 */
const SITE_ORIGIN = 'https://orthobio.ru';

/**
 * External means ANOTHER ORIGIN, not «absolute». Two exclusions, for two
 * different reasons: `localhost` is the preview server this suite runs against
 * (absolute self-links the build emits as canonical/og URLs point at
 * SITE_ORIGIN, but anything the page builds at runtime would point at the
 * preview host), and SITE_ORIGIN is us — МОО «ОРТО»'s partner card links to
 * `https://orthobio.ru/`, which is this very site.
 */
const EXTERNAL_LINKS =
  `a[href^="http"]:not([href*="localhost"]):not([href^="${SITE_ORIGIN}"])`;

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

test('an absolute link back to our own origin is not treated as external', async ({ page }) => {
  // МОО «ОРТО»'s site IS this domain (2025.yaml), so its partner card is an
  // absolute URL that must NOT open a second tab of the page we are already on.
  // The guard is the whole reason `PartnerTier` compares origins instead of
  // testing for an `http` prefix.
  await page.goto('/archive/2025');
  const selfLinks = page.locator(`a[href^="${SITE_ORIGIN}"]`);
  const count = await selfLinks.count();
  expect(count, 'the 2025 roster must still carry the ОРТО self-link').toBeGreaterThan(0);

  for (const link of await selfLinks.all()) {
    const href = await link.getAttribute('href');
    expect(await link.getAttribute('target'), `${href} is our own origin`).toBeNull();
    expect(await link.getAttribute('rel'), `${href} needs no rel without a target`).toBeNull();
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

  // The plate's signal is «filled against the page», so it also has to differ
  // from whatever surface it sits on — `--surface-section` is `.ob-band`'s
  // background too, and a tier dropped into a band would dissolve into it. This
  // is the guard that makes that a failing test instead of a silent regression.
  const ancestorBg = await static_.evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      // Skip the transparent wrappers; the first painted ancestor is the
      // surface the plate is actually read against.
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
  expect(staticBg, 'the plate must not dissolve into the surface behind it').not.toBe(ancestorBg);

  // …and the hover lift belongs to the link alone.
  const staticShadowAtRest = await static_.evaluate((el) => getComputedStyle(el).boxShadow);
  await linked.hover();
  await expect(linked).not.toHaveCSS('box-shadow', 'none');
  await static_.hover();
  await expect(static_).toHaveCSS('box-shadow', staticShadowAtRest);
});

test('the anchor offset exists only where the header is sticky', async ({ page }) => {
  // A real navigation target, not `[id]` first-in-document — that resolves to
  // the layout's <main id="main"> skip-link anchor, which nobody scrolls to and
  // which would pass the assertion without ever exercising the elements whose
  // landing position was actually wrong. `#pg2025` is the gallery anchor the
  // lightbox's ✕ returns to.
  const target = page.locator('#pg2025');

  // Below lg the header scrolls away with the page, so an 88px offset would
  // park every anchor that far past its own heading.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/archive/2025');
  await expect(target).toHaveCSS('scroll-margin-top', '0px');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/archive/2025');
  await expect(target).toHaveCSS('scroll-margin-top', '88px');
});

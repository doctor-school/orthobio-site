import { test, expect } from '@playwright/test';
import { PROFILE_ROUTES, ROUTES } from './_routes';

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

/**
 * The new tab has to be ANNOUNCED, not merely opened (WCAG 3.2.5, Issue #37).
 *
 * The sweep above proves the `target` is there; this one proves the reader is
 * told. Without it the tab switch is silent for anyone who cannot see it
 * happen, and the site's own back button appears to have died — the sharpest
 * case being a `DocCard`, where the reader thinks they are opening the program
 * and lands in a bare PDF viewer.
 *
 * Run with JAVASCRIPT OFF, and that is the point rather than a convenience: the
 * markup is what has to be honest, and one card's behaviour is rewritten by an
 * island (see the Rutube pair below). With JS disabled every link in the sweep
 * really does open a tab, so «announces it» is checked against the DOM's own
 * unconditional promise.
 */
const NEW_TAB_ANNOUNCED = /новой вкладке/i;

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every link that opens a new tab announces it in its accessible name', async ({ page }) => {
    let checked = 0;

    // Profile pages are swept too: `/partners/<slug>/` renders the company's
    // own website as a bare <a target="_blank"> outside the four link
    // components, so ROUTES alone would leave 22 pages unchecked.
    for (const path of [...ROUTES, ...PROFILE_ROUTES]) {
      await page.goto(path);

      // Media past the fold lives inside a closed <details>, and a hidden
      // subtree has NO accessible name — the assertion below would have read
      // "" for every card behind the disclosure and reported it as a missing
      // announcement, or worse, passed on a regex that tolerated the empty
      // string. Opening them is what a reader does before following one of
      // those links anyway; `<details>` toggles natively, so it works here
      // with scripting off.
      //
      // Always `first()`, never a snapshot of the matches: opening one
      // disclosure removes it from `:not([open])`, so a pre-resolved list
      // strands every later index on an element that no longer matches. The
      // initial count is the bound — one click opens exactly one.
      const closed = page.locator('details:not([open]) > summary');
      for (let remaining = await closed.count(); remaining > 0; remaining -= 1) {
        await closed.first().click();
      }

      for (const link of await page.locator(EXTERNAL_LINKS).all()) {
        const href = await link.getAttribute('href');
        await expect(
          link,
          `${path} → ${href} opens a new tab without saying so`,
        ).toHaveAccessibleName(NEW_TAB_ANNOUNCED);
        checked += 1;
      }
    }

    // PINNED, not a floor. `toBeGreaterThan(10)` would have stayed green with
    // 42 of the 53 links silently dropped from the sweep — and «dropped from
    // the sweep» is exactly how this guard dies, since a link only enters it by
    // being both rendered and reachable (the disclosures above are the proof
    // that it is easy to lose a dozen at once).
    //
    // TO UPDATE: the number is content, not behaviour — adding a partner with a
    // `url`, a video or a PDF legitimately moves it. Run the suite, take the
    // number from the failure message, and check it moved by exactly as many
    // links as the content edit added.
    expect(checked, 'the sweep must reach every external link on the site').toBe(53);
  });

  test('a Rutube card announces the tab it really opens without the island', async ({ page }) => {
    await page.goto('/archive/2025');
    await expect(page.locator('a[data-ob-video]').first()).toHaveAccessibleName(NEW_TAB_ANNOUNCED);
  });
});

test('a link that stays on this site never claims to open a tab', async ({ page }) => {
  // МОО «ОРТО»'s partner card is an absolute URL to THIS origin, so it carries
  // no `target` — and must carry no announcement either. A suffix keyed on
  // «looks like a link out» instead of on the `target` itself would promise a
  // tab that never opens, which is the same defect pointing the other way.
  await page.goto('/archive/2025');
  const selfLinks = page.locator(`a[href^="${SITE_ORIGIN}"]`);
  await expect(selfLinks).not.toHaveCount(0);

  for (const link of await selfLinks.all()) {
    const href = await link.getAttribute('href');
    await expect(link, `${href} stays in this tab`).not.toHaveAccessibleName(NEW_TAB_ANNOUNCED);
  }

  // Same claim for the internal profile cards, which is where the announcement
  // would land if it were keyed on `href^="http"` rather than on the origin.
  await page.goto('/partners');
  for (const link of await page.locator('a.ob-pt__card[href^="/partners/"]').all()) {
    await expect(link).not.toHaveAccessibleName(NEW_TAB_ANNOUNCED);
  }
});

test('a Rutube card drops the announcement once the island is running', async ({ page }) => {
  // With the island live the click never reaches the browser: the player is
  // swapped in place and no tab opens. Keeping the suffix would make the card
  // the one element on the site that announces a navigation it will not
  // perform, so the island retracts it — the same enhancement, stated in the
  // accessible name.
  await page.goto('/archive/2025');
  const cards = page.locator('a[data-ob-video]');
  await expect(cards).not.toHaveCount(0);

  for (const card of await cards.all()) {
    await expect(card).not.toHaveAccessibleName(NEW_TAB_ANNOUNCED);
  }

  // A YouTube card is NOT upgraded, so its announcement stays — here it is
  // visible copy (`.ob-vc__ext`), which is why VideoCard adds the hidden suffix
  // to the embeddable branch only and never doubles it.
  await page.goto('/archive/2021');
  await expect(page.locator('a.ob-vc').first()).toHaveAccessibleName(NEW_TAB_ANNOUNCED);
});

test('the announcement costs the visible layout nothing', async ({ page }) => {
  // The suffix is inside cards that are already pinned by the overflow ladder,
  // so a hint that took real space would surface there as a shifted card. This
  // measures the mechanism directly: out of flow, no painted box, and therefore
  // nothing for a neighbour to be pushed by.
  await page.goto('/archive/2025');
  const hints = page.locator('.ob-sr-only');
  await expect(hints).not.toHaveCount(0);

  const boxes = await hints.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { w: rect.width, h: rect.height, position: getComputedStyle(el).position };
    }),
  );
  for (const box of boxes) {
    expect(box.position, 'a hint in flow would push its siblings').toBe('absolute');
    expect(box.w).toBeLessThanOrEqual(1);
    expect(box.h).toBeLessThanOrEqual(1);
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

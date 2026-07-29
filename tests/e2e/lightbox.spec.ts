import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Lightbox keyboard contract (Issue #32).
 *
 * The gallery opens on `:target` — a fragment link, no JS — and PR #17 shipped
 * with the keyboard half of a modal missing: Escape did nothing, Tab walked
 * straight out of the overlay onto controls hidden behind a 93%-opaque scrim,
 * and closing dropped focus back to the top of the gallery. This file is the
 * regression for all three, plus the two properties the fix must NOT break:
 * the pointer path is untouched, and with the island switched off the CSS
 * lightbox still opens and closes on its own.
 *
 * `/archive/2025` is the fixture: 12 photos, so the gallery renders without the
 * «Показать все фото» disclosure and every tile is a live tab stop.
 */
const GALLERY = '#pg2025';
const FIRST_FRAME = '#pg2025-1';

/** The controls inside a frame, in document order: ✕, ←, →. The backdrop is
 *  `tabindex="-1"` and must never appear among them. */
const CONTROLS = '.ob-pg__close, .ob-pg__nav--prev, .ob-pg__nav--next';

const openFirst = async (page: import('@playwright/test').Page) => {
  const tile = page.locator('a.ob-pg__it').first();
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(FIRST_FRAME)).toBeVisible();
  return tile;
};

test('Escape closes the lightbox and hands focus back to the tile that opened it', async ({
  page,
}) => {
  await page.goto('/archive/2025');
  const tile = await openFirst(page);

  // Opening a modal that leaves focus behind the scrim is the defect one level
  // up from Escape: the first Tab has to already be inside the dialog.
  await expect(page.locator(`${FIRST_FRAME} .ob-pg__close`)).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(page.locator(FIRST_FRAME)).toBeHidden();
  expect(page.url()).toContain(GALLERY);
  await expect(tile).toBeFocused();
});

test('an open frame announces itself as a modal dialog', async ({ page }) => {
  await page.goto('/archive/2025');
  const frame = page.locator(FIRST_FRAME);
  // The attribute is a promise that everything behind the scrim is unreachable;
  // it may only exist while the island is actually enforcing that.
  await expect(frame).not.toHaveAttribute('aria-modal', 'true');

  await openFirst(page);
  await expect(frame).toHaveAttribute('role', 'dialog');
  await expect(frame).toHaveAttribute('aria-modal', 'true');
  await expect(frame).toHaveAccessibleName(/\S/);

  await page.keyboard.press('Escape');
  await expect(frame).not.toHaveAttribute('aria-modal', 'true');
});

test('Tab cycles inside the frame and never lands on the page behind the scrim', async ({
  page,
}) => {
  await page.goto('/archive/2025');
  await openFirst(page);

  const inFrame = page.locator(FIRST_FRAME).locator(CONTROLS);
  const stops = await inFrame.count();
  expect(stops, 'the frame must offer ✕, ← and →').toBe(3);

  // Two full laps forward: a trap that only holds for one wrap is not a trap.
  for (let i = 0; i < stops * 2; i += 1) {
    await page.keyboard.press('Tab');
    await expect(
      page.locator(`${FIRST_FRAME} :focus`),
      `Tab #${i + 1} escaped the dialog`,
    ).toHaveCount(1);
  }
  // …and back out the other way, past the first control.
  for (let i = 0; i < stops + 1; i += 1) {
    await page.keyboard.press('Shift+Tab');
    await expect(
      page.locator(`${FIRST_FRAME} :focus`),
      `Shift+Tab #${i + 1} escaped the dialog`,
    ).toHaveCount(1);
  }
});

test('the ←/→ arrows keep focus in the new frame, and Escape still returns to the first tile', async ({
  page,
}) => {
  await page.goto('/archive/2025');
  const tile = await openFirst(page);

  // The frame that had focus is display:none the moment the fragment moves on —
  // without an explicit hand-off the keyboard user is back at <body>.
  await page.locator(`${FIRST_FRAME} .ob-pg__nav--next`).press('Enter');
  const second = page.locator('#pg2025-2');
  await expect(second).toBeVisible();
  // Landing on → again is what makes «next, next, next» work at all.
  await expect(second.locator('.ob-pg__nav--next')).toBeFocused();

  await page.keyboard.press('Escape');
  // The trigger is where the reader came FROM, not the photo they walked to.
  await expect(tile).toBeFocused();
});

test('a deep link into a frame is operable without a trigger to return to', async ({ page }) => {
  await page.goto(`/archive/2025${FIRST_FRAME}`);
  const frame = page.locator(FIRST_FRAME);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('aria-modal', 'true');
  await expect(frame.locator('.ob-pg__close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(frame).toBeHidden();
  // Nothing opened this frame, so the island falls back to the tile that points
  // at it rather than dropping the reader at the top of the document.
  await expect(page.locator('a.ob-pg__it').first()).toBeFocused();
});

test('the pointer path is untouched by the island', async ({ page }) => {
  await page.goto('/archive/2025');
  const tile = page.locator('a.ob-pg__it').first();
  await tile.click();

  const frame = page.locator(FIRST_FRAME);
  await expect(frame).toBeVisible();

  // The backdrop closes on click and stays out of the tab order — the ✕ beside
  // it is the same action with a real label.
  await expect(frame.locator('.ob-pg__bg')).toHaveAttribute('tabindex', '-1');
  await frame.locator('.ob-pg__close').click();
  await expect(frame).toBeHidden();
  expect(page.url()).toContain(GALLERY);
});

test('a modified click is left to the browser and never becomes a stale trigger', async ({
  page,
}) => {
  await page.goto('/archive/2025');
  const tiles = page.locator('a.ob-pg__it');

  // Ctrl-click opens the photo beside the page; THIS tab does not navigate, so
  // no frame opens — and nothing may be remembered as the tile that opened one.
  await tiles.nth(4).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('#pg2025-5')).toBeHidden();
  expect(page.url()).not.toContain('#pg2025-5');

  // Now open a frame WITHOUT a click, the way a deep link or the Back gesture
  // does. A trigger recorded by the modified click would win here — the island
  // only derives one when it has none — and Escape would hand focus to a photo
  // the reader never opened (audit of PR #43: tile 5 instead of tile 1).
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, FIRST_FRAME);
  await expect(page.locator(FIRST_FRAME)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(tiles.first()).toBeFocused();
});

test('an open frame has no axe violations', async ({ page }) => {
  await page.goto('/archive/2025');
  await openFirst(page);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
  expect(
    blocking,
    `axe violations with the lightbox open: ${JSON.stringify(
      blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })),
      null,
      2,
    )}`,
  ).toEqual([]);
});

/**
 * The island is an upgrade, never a replacement: the fragment lightbox is CSS,
 * and it has to keep opening and closing where the module never runs (a proxy
 * that strips `type="module"`, an extension, a future `script-src 'self'`).
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the :target lightbox still opens and closes', async ({ page }) => {
    await page.goto('/archive/2025');
    const frame = page.locator(FIRST_FRAME);
    await expect(frame).toBeHidden();

    await page.locator('a.ob-pg__it').first().click();
    await expect(frame).toBeVisible();
    // No island, no promise of modality.
    await expect(frame).not.toHaveAttribute('aria-modal', 'true');

    await frame.locator('.ob-pg__close').click();
    await expect(frame).toBeHidden();
  });
});

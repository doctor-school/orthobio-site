import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * The focus indicator, as the browser actually computes it (issue #35, review of
 * PR #44).
 *
 * `tests/unit/focus-ring.test.ts` measures the CONTRAST of the two rungs and
 * guards the structure of the stylesheet. What it cannot see is the cascade:
 * whether the rule that declares the ring is the one that wins on a real element
 * in a real state. That gap is not theoretical — five card components
 * (`a.ob-yc`, `a.ob-pt__card`, `a.ob-pg__it`, `.ob-vc`, `a.ob-dc`) each declared
 * a hover shadow with a selector more specific than `:focus-visible`, and a card
 * that was focused AND hovered lost its ring completely: the measured
 * `box-shadow` was `--shadow-lift` alone. Nothing in the suite noticed, because
 * axe does not audit focus indicators and no test had ever read a computed
 * `box-shadow`.
 *
 * Every assertion here therefore goes through `expect.poll`, never a bare
 * `evaluate`: the cards transition `box-shadow` over `--t-state` (130ms), so a
 * value read on the frame after `hover()` is still the previous state's. Poll
 * retries until the transition settles — a one-shot read reports «no ring» for a
 * ring that is on its way in.
 */

/** One focusable element per component that paints its own elevation. */
const CASES = [
  { path: '/', selector: '.ob-skip', label: 'skip link (on the primary blue fill)' },
  { path: '/archive/', selector: 'a.ob-yc', label: 'year card' },
  { path: '/partners', selector: 'a.ob-pt__card', label: 'partner card' },
  { path: '/archive/2025', selector: 'a.ob-pg__it', label: 'photo tile' },
  { path: '/archive/2025', selector: '.ob-vc', label: 'video card (over the --ink facade)' },
  { path: '/archive/2024', selector: 'a.ob-dc', label: 'document card' },
] as const;

/**
 * Chromium only matches `:focus-visible` when the last input was a keyboard, so
 * the Tab press is not decoration — it arms the heuristic that `focus()` then
 * inherits. Tabbing all the way to each element instead would walk the whole
 * 8-item nav on every case and assert nothing extra.
 */
async function focusByKeyboard(page: Page, element: Locator) {
  await element.scrollIntoViewIfNeeded();
  await page.keyboard.press('Tab');
  await element.evaluate((node: HTMLElement) => node.focus());
  await expect
    .poll(() => element.evaluate((node) => node.matches(':focus-visible')))
    .toBe(true);
}

/**
 * Any CSS colour function (`rgb(…)`, `oklch(…)`, `color(…)`): the computed value
 * keeps the notation a token is authored in, so pinning `rgb(` would break the
 * day a token moves to `oklch()`.
 */
const COLOR = String.raw`[a-z-]+\([^)]*\)`;

/** The shadow layers the browser computed, split on the commas between them. */
function shadowLayers(element: Locator) {
  return element.evaluate((node) =>
    getComputedStyle(node)
      .boxShadow.split(/,(?![^(]*\))/)
      .map((layer) => layer.trim()),
  );
}

/**
 * Both rungs, in order, with different colours. Reading the colours off the page
 * rather than pinning `rgb(17, 77, 158)` keeps this a test of the INDICATOR: the
 * token may be retuned without touching the spec, but the ring cannot silently
 * collapse to one tone or to none.
 */
async function expectTwoToneRing(element: Locator, context: string) {
  await expect
    .poll(async () => (await shadowLayers(element)).slice(0, 2).join(' | '), {
      message: `two-tone focus ring on ${context}`,
    })
    .toMatch(new RegExp(`^${COLOR} 0px 0px 0px 2px \\| ${COLOR} 0px 0px 0px 4px$`));

  const [halo, ring] = await shadowLayers(element);
  expect(halo.replace(/ 0px.*/, ''), `halo and ring are the same colour on ${context}`).not.toBe(
    ring.replace(/ 0px.*/, ''),
  );
}

test.describe('the focus ring survives every state it shares an element with', () => {
  for (const { path, selector, label } of CASES) {
    test(`${label} keeps its ring when focused, and when focused AND hovered`, async ({ page }) => {
      await page.goto(path);
      const element = page.locator(selector).first();

      await focusByKeyboard(page, element);
      await expectTwoToneRing(element, `${label} — focused`);

      await element.hover();
      await expectTwoToneRing(element, `${label} — focused + hovered`);
    });
  }

  test('a hovered card still shows its own elevation on top of the ring', async ({ page }) => {
    // The ring wins the cascade, so it MUST compose rather than replace: a card
    // that dropped its hover lift the moment it gained focus would be a
    // regression in the other direction.
    await page.goto('/archive/');
    const card = page.locator('a.ob-yc').first();

    await focusByKeyboard(page, card);
    await expect.poll(async () => (await shadowLayers(card)).length).toBe(3);

    await card.hover();
    await expect
      .poll(async () => (await shadowLayers(card)).at(-1), {
        message: 'the hover lift should be the last layer, behind the ring',
      })
      .toMatch(/16px/);
  });

  test('the mobile menu trigger keeps its ring when focused and hovered', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/');
    const trigger = page.locator('.ob-menu summary');

    await focusByKeyboard(page, trigger);
    await expectTwoToneRing(trigger, 'mobile menu trigger — focused');

    await trigger.hover();
    await expectTwoToneRing(trigger, 'mobile menu trigger — focused + hovered');
  });
});

test.describe('the «Консенсусы» item (Issue #122)', () => {
  test('the current-page ring and the focus ring are both painted on the desktop item', async ({ page }) => {
    await page.goto('/consensus/');
    const item = page.locator('.ob-nav a.ob-nav__link--accent');
    await expect(item).toHaveAttribute('aria-current', 'page');

    await focusByKeyboard(page, item);
    await expectTwoToneRing(item, 'the current accent item — focused');
    // The unlayered focus rule replaces `box-shadow`; the inner ring survives
    // only because it travels through `--shadow-state`.
    await expect
      .poll(async () => (await shadowLayers(item)).slice(2).join(' | '))
      .toMatch(new RegExp(`^${COLOR} 0px 0px 0px 1px inset$`));

    await item.hover();
    await expectTwoToneRing(item, 'the current accent item — focused + hovered');
    await expect
      .poll(async () => (await shadowLayers(item)).slice(2).join(' | '))
      .toMatch(new RegExp(`^${COLOR} 0px 0px 0px 1px inset$`));
  });

  test('a focused mobile panel item is stacked above the item that follows it', async ({ page }) => {
    // The items sit flush and the ring reaches 4px past the box, so the next
    // item's permanent fill (the green accent one) would paint over the ring's
    // lower edge. Painting order is not observable through `elementFromPoint`
    // (a box-shadow is not hit-testable), so the stacking itself is asserted.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/');
    await page.locator('.ob-menu summary').click();

    const accent = page.locator('.ob-menu__panel a.ob-nav__link--accent');
    const before = accent.locator('xpath=preceding-sibling::a[1]');
    await expect(before).toBeVisible();

    await focusByKeyboard(page, before);
    await expectTwoToneRing(before, 'the panel item above the accent one — focused');

    const stacking = await Promise.all(
      [before, accent].map((item) =>
        item.evaluate((node) => {
          const { position, zIndex } = getComputedStyle(node);
          return { position, z: zIndex === 'auto' ? 0 : Number(zIndex) };
        }),
      ),
    );
    expect(stacking[0].position, 'z-index does nothing on a static item').not.toBe('static');
    expect(stacking[0].z, 'the focused item must out-stack its neighbour').toBeGreaterThan(stacking[1].z);
  });
});

test('forced colours replace the ring with a system outline', async ({ page }) => {
  // Forced-colours mode discards box-shadows outright. Without the escape hatch
  // in base.css the `outline: none` that made room for the ring is all that is
  // left, and a High Contrast user navigates with no indicator at all.
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/archive/2025');
  const link = page.locator('a.ob-yc, .ob-nav a').first();

  await focusByKeyboard(page, link);

  const styles = await link.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      boxShadow: computed.boxShadow,
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      outlineOffset: computed.outlineOffset,
    };
  });

  expect(styles.boxShadow, 'forced colours are expected to drop the shadow').toBe('none');
  expect(styles.outlineStyle).toBe('solid');
  expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThan(0);
  expect(Number.parseFloat(styles.outlineOffset)).toBeGreaterThan(0);
});

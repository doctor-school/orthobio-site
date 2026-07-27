import { expect, type Page } from '@playwright/test';

/**
 * Shared horizontal-overflow guard. Ported from
 * `bbm-public-website/tests/e2e/_overflow.ts` (its issues #47/#83) — the donor
 * shipped a real overflow defect that a single-width eyeball check missed.
 *
 * ── The scrollbar blind spot ────────────────────────────────────────────────
 * Headless Chromium renders OVERLAY scrollbars, so a vertical scrollbar does
 * NOT subtract from `clientWidth`. Content that overflows only once a CLASSIC
 * scrollbar takes its gutter (Windows/most Linux desktops) would stay green.
 * We therefore shrink the viewport by a classic-scrollbar gutter first, letting
 * the layout genuinely reflow into the usable width a real user has, and run
 * the plain `scrollWidth - clientWidth <= 0` check on that layout. Fully
 * deterministic and identical on CI and Windows.
 *
 * SCROLLBAR_GUTTER = 17px: Blink's classic vertical scrollbar on Windows — the
 * widest mainstream value, i.e. the conservative worst case.
 */
export const SCROLLBAR_GUTTER = 17;

/**
 * The canonical ladder from AGENTS.md: 360 (smallest supported phone — worst
 * case for long unbreakable Russian tokens), 390 (a real modern phone) and the
 * Tailwind tiers 768 / 1024 / 1280.
 */
export const OVERFLOW_WIDTHS = [360, 390, 768, 1024, 1280] as const;

/** CSS px by which the document exceeds the viewport; ≤ 0 means no overflow. */
export async function measureOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth - de.clientWidth;
  });
}

/** Load `path` at the usable width of `nominal` and assert zero overflow. */
export async function expectNoOverflow(
  page: Page,
  path: string,
  nominal: number,
): Promise<void> {
  const usableWidth = nominal - SCROLLBAR_GUTTER;
  await page.setViewportSize({ width: usableWidth, height: 900 });
  await page.goto(path);
  const overflow = await measureOverflow(page);
  expect(
    overflow,
    `${path} overflows the usable width ${usableWidth}px ` +
      `(nominal ${nominal}px − ${SCROLLBAR_GUTTER}px classic scrollbar gutter) by ${overflow}px`,
  ).toBeLessThanOrEqual(0);
}

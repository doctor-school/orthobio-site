import { test, expect } from '@playwright/test';
import { ROUTES, YEAR_ROUTES } from './_routes';

/**
 * Content-integrity guards for the ТЗ §4 principles: honest placeholders, no
 * external archive links, approved contacts only, 2026 never dressed up as 2027.
 */

test('every route of the §4 map is reachable', async ({ page }) => {
  for (const path of ROUTES) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} must be built`).toBeLessThan(400);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('/program is an honest stub pointing at the 2026 program', async ({ page }) => {
  await page.goto('/program');
  await expect(page.getByText('в разработке')).toBeVisible();
  await expect(page.getByRole('link', { name: /программу 2026/i })).toHaveAttribute(
    'href',
    '/archive/2026',
  );
});

test('the home page never presents 2026 content as 2027', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2027');
  // Exact values matter: geometry/a11y stay green if a plausible wrong date ships.
  await expect(page.getByText('23–24 апреля 2027', { exact: true })).toBeVisible();
  // Figures are labelled as past congresses…
  await expect(page.getByText(/прошедших конгрессов/i)).toBeVisible();
  // …and the caption dates only the range the archive can show. 2020 was an
  // inference, not a sourced year (PR #17 review).
  await expect(page.locator('body')).not.toContainText('2020');
});

test('the home page launches without a subscription CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Регистрация откроется в ноябре 2026 года')).toBeVisible();
  await expect(page.getByRole('link', { name: /узнать первым/i })).toHaveCount(0);
  await expect(page.getByText(/канал.*будет объявлен/i)).toHaveCount(0);
});

test('only the owner-approved public contacts are published', async ({ page }) => {
  for (const path of ['/contacts', '/partners', '/faq', '/']) {
    await page.goto(path);
    const html = await page.content();
    expect(html, `${path} must not carry the operator mailbox`).not.toContain(
      'welcome@congress-ph.ru',
    );
    expect(html, `${path} must not carry the operator phone`).not.toContain('+7 (812) 677-31-56');
  }

  await page.goto('/contacts');
  const main = page.locator('#main');
  await expect(main.getByRole('link', { name: 'manager@doctor.school' })).toHaveAttribute(
    'href',
    'mailto:manager@doctor.school',
  );
  await expect(main.getByRole('link', { name: '8 (495) 410-04-90' })).toHaveAttribute(
    'href',
    'tel:84954100490',
  );
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'manager@doctor.school' })).toHaveAttribute(
    'href',
    'mailto:manager@doctor.school',
  );
  await expect(footer.getByRole('link', { name: '8 (495) 410-04-90' })).toHaveAttribute(
    'href',
    'tel:84954100490',
  );

  await page.goto('/partners');
  await expect(
    page.getByRole('link', { name: 'Стать партнёром — написать команде конгресса' }),
  ).toHaveAttribute('href', 'mailto:manager@doctor.school');
});

test('archive pages link to no external content host', async ({ page }) => {
  // ТЗ §4 principle 1: the archive lives here; media is ours. Video reports on
  // YouTube/Rutube are the documented exception (schemas.ts ALLOWED_VIDEO_HOSTS).
  const forbidden = [
    'creatium.site',
    'drive.google.com',
    'disk.yandex',
    'congress-ph',
    'photos.c-ph.ru',
    'b24-ieosll',
  ];
  for (const path of ['/archive/', ...YEAR_ROUTES]) {
    await page.goto(path);
    const hrefs = await page.locator('a[href], img[src]').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('href') ?? n.getAttribute('src') ?? ''),
    );
    for (const url of hrefs) {
      for (const host of forbidden) {
        expect(url, `${path} links to a legacy external host`).not.toContain(host);
      }
    }
  }
});

test('the draft fixture year is not published', async ({ page }) => {
  await page.goto('/archive/');
  await expect(page.getByRole('link', { name: /2099/ })).toHaveCount(0);
  const response = await page.goto('/archive/2099');
  expect(response?.status()).toBe(404);
});

test('a year page renders its data and says «нет данных» for what is missing', async ({ page }) => {
  // 2021: gallery + videos exist, no program and no theses survived.
  await page.goto('/archive/2021');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2021');
  await expect(page.locator('.ob-pg img').first()).toBeVisible();
  const program = page.locator('.ob-section', { has: page.getByRole('heading', { name: 'Программа' }) });
  await expect(program.getByText('нет данных')).toBeVisible();
});

test('a 2027 page opens with its stub, before any 2026 data', async ({ page }) => {
  // The regression this guards is ordering, not presence: the copy already said
  // «состав 2027 будет объявлен», but it sat under one line of lead followed by
  // two screens of 2026 data, and the data won (content audit К1/С3).
  for (const [path, dataSelector] of [
    ['/partners', '.ob-pt'],
    ['/orgs', '.ob-cl'],
  ] as const) {
    await page.goto(path);
    const stubFirst = await page.evaluate((selector) => {
      const stub = document.querySelector('.ob-stub');
      const data = document.querySelector(selector);
      if (!stub || !data) return null;
      // eslint-disable-next-line no-bitwise
      return Boolean(stub.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, dataSelector);
    expect(stubFirst, `${path} must open with the 2027 stub`).toBe(true);
  }
});

test('the footer claims no 2027 supporter', async ({ page }) => {
  await page.goto('/partners');
  const footer = await page.locator('.ob-foot').innerText();
  expect(footer).not.toContain('При поддержке');
  expect(footer).toContain('© 2021–2027');
});

test('the photo lightbox opens and closes without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/archive/2022');
  const lightbox = page.locator('#pg2022-1');
  await expect(lightbox).toBeHidden();
  await page.locator('.ob-pg__it').first().click();
  await expect(lightbox).toBeVisible();
  // ←/→ cycle, ✕ returns to the gallery anchor.
  await lightbox.getByRole('link', { name: 'Следующее фото' }).click();
  await expect(page.locator('#pg2022-2')).toBeVisible();
  await page.locator('#pg2022-2 .ob-pg__close').click();
  await expect(page.locator('#pg2022-2')).toBeHidden();
  await context.close();
});

test('media past the fold is disclosed without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/archive/2022');
  // 2022 holds 8 videos; three are up front, the rest behind the disclosure.
  const hidden = page.locator('.ob-mg__more .ob-vc');
  await expect(hidden.first()).toBeHidden();
  await page.locator('.ob-mg__more summary').click();
  await expect(hidden.first()).toBeVisible();

  // The photo gallery holds 12 frames against a default of 11 visible, so its
  // disclosure would have unfolded a SINGLE tile; below the floor PhotoGrid
  // shows the set whole and renders no disclosure at all (PR #17 review).
  await expect(page.locator('.ob-pg__more')).toHaveCount(0);
  await expect(page.locator('.ob-pg__grid .ob-pg__it')).toHaveCount(12);
  await context.close();
});

test('/orgs actually renders the оргкомитет portraits, not the fallback plate', async ({
  page,
}) => {
  // Regression guard for Issue #23. Every other suite stays green if the
  // portraits vanish: drop a `photo:` key, break `mediaUrl()`, or move the
  // bucket objects, and PersonCard silently falls back to the initials plate —
  // valid DOM, valid a11y, zero overflow, zero CLS. The COUNT is the assertion.
  await page.goto('/orgs');
  const portraits = page.locator('#orgs26 img.ob-pc__photo');
  await expect(portraits).toHaveCount(11);

  // Explicit intrinsic dimensions on every tag: the schema carries a portrait
  // as a bare URL, so the box is reserved only because <Image> measured the
  // file at build. A missing attribute here IS the CLS regression.
  const boxes = await portraits.evaluateAll((nodes) =>
    nodes.map((n) => ({
      w: n.getAttribute('width'),
      h: n.getAttribute('height'),
      alt: n.getAttribute('alt'),
      src: n.getAttribute('src'),
    })),
  );
  for (const box of boxes) {
    expect(Number(box.w), `width must be a positive number, got ${box.w}`).toBeGreaterThan(0);
    expect(Number(box.h), `height must be a positive number, got ${box.h}`).toBeGreaterThan(0);
    // Decorative: the name is the adjacent .ob-pc__name (see PersonCard.astro).
    expect(box.alt).toBe('');
    expect(box.src, 'portraits must be served from our own build output').toMatch(/^\/_astro\//);
  }

  // The twelfth member, Загородний Н. В., has no portrait anywhere on the old
  // site — his plate is the honest state and must NOT quietly gain a photo.
  await expect(page.locator('#orgs26 .ob-pc__initial')).toHaveCount(1);
});

/**
 * Portrait census per archive year — the same count guard as /orgs, extended to
 * the 13 references /orgs does not cover (PR #28 review).
 *
 * These are the entries most likely to rot: every one of them points at a
 * `2026/people/` key from a DIFFERENT year's file, and that cross-year reuse is
 * the judgment call most likely to be revisited. Null those keys and no other
 * suite notices — the cards degrade to a valid, accessible initials plate.
 *
 * `initials` is asserted alongside `photos` on purpose: it pins the people who
 * must STAY without a portrait (Загородний, Губин — no usable image exists for
 * either anywhere on the old site), so the guard fails in both directions.
 */
const PORTRAIT_CENSUS = [
  { year: 2021, photos: 0, initials: 2 }, // Губин + Загородний, no portraits exist
  { year: 2022, photos: 1, initials: 2 }, // Страхов greeting; Загородний + Губин plates
  { year: 2023, photos: 1, initials: 2 },
  { year: 2024, photos: 1, initials: 2 },
  { year: 2025, photos: 10, initials: 1 }, // 9 committee + Страхов greeting; Загородний plate
  { year: 2026, photos: 11, initials: 1 }, // committee; Загородний has no /orgs card
] as const;

for (const { year, photos, initials } of PORTRAIT_CENSUS) {
  test(`/archive/${year} renders ${photos} portrait(s) and ${initials} initials plate(s)`, async ({
    page,
  }) => {
    await page.goto(`/archive/${year}`);
    await expect(page.locator('img.ob-pc__photo')).toHaveCount(photos);
    await expect(page.locator('.ob-pc__initial')).toHaveCount(initials);
    // Same no-CLS contract as /orgs: the schema carries a bare URL, so the box
    // is reserved only because <Image> measured the file at build.
    const boxes = await page
      .locator('img.ob-pc__photo')
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ w: n.getAttribute('width'), h: n.getAttribute('height') })),
      );
    for (const box of boxes) {
      expect(Number(box.w)).toBeGreaterThan(0);
      expect(Number(box.h)).toBeGreaterThan(0);
    }
  });
}

test('FAQ answers open without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/faq');
  const firstAnswer = page.locator('.ob-faq__a').first();
  // The ANSWER is what must appear: a <details> element is visible while
  // collapsed too, so asserting on it proved nothing (PR #14 review).
  await expect(firstAnswer).toBeHidden();
  await page.locator('.ob-faq__q').first().click();
  await expect(firstAnswer).toBeVisible();
  await context.close();
});

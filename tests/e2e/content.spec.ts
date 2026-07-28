import { test, expect } from '@playwright/test';
import { ROUTES, YEAR_ROUTES } from './_routes';

/**
 * Content-integrity guards for the ТЗ §4 principles: honest placeholders, no
 * external archive links, no operator contact, 2026 never dressed up as 2027.
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
  // The dates placeholder IS the fact — no invented 2027 dates.
  await expect(page.getByText(/даты уточняются/i)).toBeVisible();
  // Figures are labelled as past congresses…
  await expect(page.getByText(/прошедших конгрессов/i)).toBeVisible();
  // …and the caption dates only the range the archive can show. 2020 was an
  // inference, not a sourced year (PR #17 review).
  await expect(page.locator('body')).not.toContainText('2020');
});

test('the operator mailbox is never published', async ({ page }) => {
  for (const path of ['/contacts', '/partners', '/faq', '/']) {
    await page.goto(path);
    const html = await page.content();
    expect(html, `${path} must not carry the operator mailbox`).not.toContain(
      'welcome@congress-ph.ru',
    );
  }
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

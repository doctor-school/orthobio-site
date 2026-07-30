import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';
import { measureOverflow, OVERFLOW_WIDTHS } from './_overflow';
import { PROFILE_ROUTES, ROUTES } from './_routes';

const PRODUCTION_ORIGIN = 'https://orthobio.ru';
const UNKNOWN_ROUTE = '/__orthobio_e2e_missing__';

test('robots.txt points crawlers at the canonical production sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain\b/);
  expect(await response.text()).toBe(
    'User-agent: *\nAllow: /\n\nSitemap: https://orthobio.ru/sitemap.xml\n',
  );
});

test('sitemap.xml contains all and only canonical public pages', async ({ page, request }) => {
  const response = await request.get('/sitemap.xml');
  const body = await response.text();

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^(application|text)\/xml\b/);

  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    return {
      error: document.querySelector('parsererror')?.textContent ?? null,
      locations: [...document.querySelectorAll('url > loc')].map((node) => node.textContent),
    };
  }, body);
  const expected = [...ROUTES, ...PROFILE_ROUTES].map(
    (route) => new URL(route, PRODUCTION_ORIGIN).href,
  );

  expect(parsed.error).toBeNull();
  expect(parsed.locations).toEqual(expected);
  expect(new Set(parsed.locations).size).toBe(parsed.locations.length);
  expect(body).not.toContain('new.orthobio.ru');
  expect(body).not.toContain('/404');
});

for (const width of OVERFLOW_WIDTHS) {
  test(`the branded 404 holds at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(UNKNOWN_ROUTE);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Страница не найдена' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Открыть архив' })).toHaveAttribute(
      'href',
      '/archive/',
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

    expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoHeadingSpill(page, `${UNKNOWN_ROUTE} @${width}`);
    await expectNoColumnOverlap(page, `${UNKNOWN_ROUTE} @${width}`);

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const blocking = results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    );
    expect(blocking, `axe violations on 404 at ${width}px: ${JSON.stringify(blocking)}`).toEqual([]);
  });
}

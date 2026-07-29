import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { PROFILE_ROUTES } from './_routes';
import { expectNoOverflow, OVERFLOW_WIDTHS } from './_overflow';
import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';

/**
 * Partner profile pages (`/partners/<slug>/`, Issue #24) — the replacement for
 * the old site's `/company?i=<id>`.
 *
 * Every profile is checked, not a sample: the pages are one template but their
 * CONTENT is 22 independently written blocks of Russian prose, and the failure
 * modes live in the content — a 30-character unbroken legal name, an address
 * that is one long line, a company that published no email. Those only show up
 * on the page that has them.
 *
 * Widths are the shared `OVERFLOW_WIDTHS` ladder (360 / 390 / 768 / 1024 /
 * 1280), not a subset: AGENTS.md mandates the full ladder for every
 * UI-affecting change, and a local list would silently stop matching it the
 * next time the ladder moves.
 */

test('the archive really does generate profile routes', () => {
  // Guards the derivation itself: if PROFILE_ROUTES ever came back empty, every
  // parametrised test below would silently pass by not existing.
  expect(PROFILE_ROUTES.length).toBe(22);
});

test.describe('partner profiles', () => {
  for (const path of PROFILE_ROUTES) {
    test(`${path} renders the company`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `${path} must be built`).toBeLessThan(400);

      // An <h1> with the company name, a description section, and the way back
      // — the three things that make this a profile rather than a shell.
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      await expect(h1).not.toBeEmpty();
      await expect(page.getByRole('link', { name: 'К списку компаний' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'О компании' })).toBeVisible();
    });

    for (const width of OVERFLOW_WIDTHS) {
      test(`${path} at ${width}px: no overflow, headings and columns hold`, async ({ page }) => {
        await expectNoOverflow(page, path, width);
        // Same viewport the overflow guard just used, so the assertions below
        // describe the same layout it measured.
        await expectNoHeadingSpill(page, `${path} @${width}`);
        await expectNoColumnOverlap(page, `${path} @${width}`);
      });
    }

    test(`${path} is axe clean`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 900 });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );
      expect(
        blocking,
        `axe violations on ${path}: ${JSON.stringify(
          blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })),
          null,
          2,
        )}`,
      ).toEqual([]);
      // heading-order is only MODERATE impact, so the filter above would never
      // catch a broken outline (donor lesson, bbm#83).
      const order = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
      expect(order.violations, `heading-order on ${path}`).toEqual([]);
    });
  }
});

/**
 * The link that makes the profiles reachable at all. Before Issue #24 the 22
 * exhibitor cards on /partners were inert `<span>`s — a reader had no way in.
 */
test('every exhibitor card on /partners opens its profile', async ({ page }) => {
  await page.goto('/partners');
  const links = page.locator('.ob-pt__card[href^="/partners/"]');
  await expect(links).toHaveCount(22);

  // Follow one end to end, so «the href exists» is not mistaken for «the page
  // is there»: a card could point at a slug the build never emitted.
  const first = links.first();
  const href = await first.getAttribute('href');
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // …and back again, which is the whole job of the breadcrumb.
  await page.getByRole('link', { name: 'К списку компаний' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /партнёр/i })).toBeVisible();
});

/**
 * The card has to SAY that it opens a profile.
 *
 * Without a visible label a profile card and an external-site card are the same
 * outlined white rectangle, so nothing distinguishes «this keeps you on the
 * site» from «this sends you to the vendor» (responsive-a11y audit of PR #40).
 * The label also has to stay INSIDE the card's single anchor — a second link
 * beside it would nest anchors — so what is asserted is: visible text, exactly
 * one tab stop per card, and no label on the cards that leave the site.
 */
test('a profile card shows a visible «Подробнее» affordance, external cards do not', async ({
  page,
}) => {
  await page.goto('/partners');

  const profileCards = page.locator('a.ob-pt__card[href^="/partners/"]');
  await expect(profileCards).toHaveCount(22);
  await expect(profileCards.locator('.ob-pt__more')).toHaveCount(22);
  await expect(profileCards.first().locator('.ob-pt__more')).toBeVisible();
  await expect(profileCards.first().locator('.ob-pt__more')).toHaveText('Подробнее');

  // Still ONE link per card: the label is a <span>, not a nested <a>.
  expect(await profileCards.first().locator('a').count()).toBe(0);

  // The accessible name carries both the organization and the action.
  const name = await profileCards.first().evaluate((el) => el.textContent?.trim() ?? '');
  expect(name).toContain('Подробнее');

  // A card that leaves the site keeps its plain look — the label would be a lie
  // there, and its new-tab semantics already say «this goes elsewhere».
  const external = page.locator('a.ob-pt__card:not([href^="/partners/"])');
  if ((await external.count()) > 0) {
    await expect(external.locator('.ob-pt__more')).toHaveCount(0);
  }
});

/**
 * ТЗ §4 «никаких внешних архивных ссылок» applies to MEDIA, not to attribution:
 * a partner's own website is legitimately external. What must never appear is
 * the retired operator's platform — the profiles were rescued FROM it precisely
 * so nothing keeps pointing at it.
 */
test('no profile links back to the operator platform it was rescued from', async ({ page }) => {
  for (const path of PROFILE_ROUTES) {
    await page.goto(path);
    const hrefs = await page.locator('a[href]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href') ?? ''),
    );
    for (const href of hrefs) {
      expect(href, `${path} still links to the old platform`).not.toMatch(
        /congress-ph|orthobio\.ru\/company/,
      );
    }
  }
});

/**
 * A profile page must show the company's OWN facts, not a neighbour's. Checked
 * on the two profiles whose data differs most: one with every channel filled,
 * one that published no email and no phone at all.
 */
test('a fully-populated profile prints all of its contact facts', async ({ page }) => {
  await page.goto('/partners/dr-reddys/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dr. Reddy');
  await expect(page.getByText('115035')).toBeVisible();
  await expect(page.getByRole('link', { name: 'inforus@drreddys.com' })).toHaveAttribute(
    'href',
    'mailto:inforus@drreddys.com',
  );
  await expect(page.getByRole('link', { name: 'www.drreddys.ru' })).toHaveAttribute(
    'href',
    'https://www.drreddys.ru',
  );
});

test('a profile with no published email or phone omits those rows, honestly', async ({ page }) => {
  // «Северная звезда» published a website only — the contacts block is null.
  await page.goto('/partners/severnaya-zvezda/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Северная звезда');
  await expect(page.getByText('Адрес')).toBeVisible();
  // No invented placeholder, and no empty labelled row either.
  await expect(page.getByText('Электронная почта')).toHaveCount(0);
  await expect(page.getByText('Телефон')).toHaveCount(0);
});

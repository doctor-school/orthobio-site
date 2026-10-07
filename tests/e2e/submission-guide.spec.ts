import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { waitForWebfonts } from './_fonts';
import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';
import { expectNoOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';

/**
 * «Как подать материалы» on /participants (Issue #99). The exact dates and the
 * approved wording are values, asserted in tests/unit/submission-guide.test.ts;
 * this spec pins what only the rendered page can show:
 *
 * - the permanent anchor #podat-materialy lands on the section (the letter to
 *   registered participants links to it);
 * - the ten steps render in order; step 2 is a numbered list of five
 *   sub-steps with a screenshot after the third and the fourth, the sign-in
 *   button and a secondary note;
 * - every date token was filled — the page never shows «{{…}}»;
 * - every screenshot actually loads from our bucket at its declared size, and
 *   none of them pushes the page or its card wider than the viewport.
 */
const SECTION = '#podat-materialy';

const STEP_TITLES = [
  '1. Кто может подать материалы',
  '2. Как войти в кабинет',
  '3. Кабинет «Мои заявки на Конгресс»',
  '4. Устный доклад',
  '5. Постерный доклад',
  '6. Тезисы',
  '7. Согласие на обработку персональных данных',
  '8. Сроки',
  '9. После отправки',
  '10. Частые вопросы',
];

// CABINET_LOGIN_URL in src/config/site.ts — that module touches
// `import.meta.env`, so the suite cannot import it (see signup.spec.ts); the
// unit test holds the config to the same address.
const CABINET_LOGIN_URL = 'https://new.doctor.school/login?method=code&returnTo=/account/congress';

const unbreak = (s: string) => s.replace(/ /g, ' ');

test.describe('submission guide section', () => {
  test('the permanent anchor lands on the section', async ({ page }) => {
    await page.goto(`/participants${SECTION}`);
    const section = page.locator(SECTION);
    await expect(section).toBeInViewport();
    await expect(section).toHaveAttribute('aria-labelledby', 'podat-materialy-title');
    await expect(section.locator('h2')).toHaveText(
      /^\s*Как\sподать\sматериалы\sна\sVIII\sКонгресс\s«Ортобиология\s2027»\s*$/,
    );
  });

  test('renders the ten approved steps in order', async ({ page }) => {
    await page.goto('/participants');
    const titles = (await page.locator(`${SECTION} h3`).allTextContents()).map((t) => unbreak(t).trim());
    expect(titles).toEqual(STEP_TITLES);
  });

  test('step 2 walks the sign-in as five numbered sub-steps, a shot after the third, the screen and the letter after the fourth', async ({ page }) => {
    await page.goto('/participants');
    const items = page.locator('#podat-materialy-2 ol > li');
    await expect(items).toHaveCount(5);
    const shots = await items.evaluateAll((lis) => lis.map((li) => li.querySelectorAll('img').length));
    expect(shots).toEqual([0, 0, 1, 2, 0]);
    await expect(items.nth(2).locator('img')).toHaveAttribute('src', /\/2027\/submissions\/login-02-[a-z0-9-]+\.png$/);
    await expect(items.nth(3).locator('img').first()).toHaveAttribute('src', /\/2027\/submissions\/login-03-[a-z0-9-]+\.png$/);
    await expect(items.nth(3).locator('img').last()).toHaveAttribute('src', /\/2027\/submissions\/letter-code\.png$/);
    // List → button → the secondary note, in reading order.
    const order = await page
      .locator('#podat-materialy-2 > *')
      .evaluateAll((els) => els.map((el) => (el.matches('ol') ? 'list' : el.matches('.ob-btn') ? 'button' : el.matches('.ob-acc__note') ? 'note' : null)).filter(Boolean));
    expect(order).toEqual(['list', 'button', 'note']);
  });

  test('«Войти в кабинет» opens the Doctor.School sign-in by code in a new tab', async ({ page }) => {
    await page.goto('/participants');
    const button = page.locator('#podat-materialy-2').getByRole('link', { name: /^Войти в кабинет/ });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('href', CABINET_LOGIN_URL);
    await expect(button).toHaveAttribute('target', '_blank');
    await expect(button).toHaveClass(/(^|\s)ob-btn(\s|$)/);
  });

  test('prints the dates from the site settings, never a raw token', async ({ page }) => {
    await page.goto('/participants');
    const text = unbreak((await page.locator(SECTION).textContent()) ?? '');
    expect(text).not.toContain('{{');
    expect(text).not.toMatch(/приём открыт|открыт приём/);
    expect(text).toMatch(/«Забрать на исправление» до окончания приёма своего вида: устные доклады — до \d{1,2} [а-я]+ \d{4} года/);
    expect(text).toMatch(/устные доклады — до \d{1,2} [а-я]+ \d{4} года, постерные доклады и тезисы — до \d{1,2} [а-я]+ \d{4} года, до 23:59/);
    expect(text).toMatch(/устный доклад — \d{1,2} [а-я]+ \d{4} года; постерный доклад и тезисы — \d{1,2} [а-я]+ \d{4} года\./);
    expect(text).toMatch(/младше 40 лет на \d{1,2} [а-я]+ \d{4}: родились \d{2}\.\d{2}\.\d{4} или позже — можно; \d{2}\.\d{2}\.\d{4} или раньше — нельзя/);
  });

  test('«Зарегистрироваться» opens the on-site registration form', async ({ page }) => {
    await page.goto('/participants');
    const link = page.locator('#podat-materialy-1').getByRole('link', { name: '«Зарегистрироваться»' });
    await expect(link).toHaveAttribute('href', '/registration');
    await expect(link).not.toHaveAttribute('target', /.*/);
  });

  test('every screenshot loads from our bucket at its declared size', async ({ page }) => {
    await page.goto('/participants');
    const imgs = page.locator(`${SECTION} img`);
    await expect(imgs).toHaveCount(14);
    for (const img of await imgs.all()) {
      await expect(img).toHaveAttribute('src', /^https:\/\/s3\.twcstorage\.ru\/orthobio-media\/2027\/submissions\/((login-)?\d{2}-[a-z0-9-]+|letter-code)\.png$/);
      await expect(img).toHaveAttribute('loading', 'lazy');
      expect((await img.getAttribute('alt'))?.length ?? 0).toBeGreaterThan(40);
      await img.scrollIntoViewIfNeeded();
      const width = Number(await img.getAttribute('width'));
      const height = Number(await img.getAttribute('height'));
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? [el.naturalWidth, el.naturalHeight] : null)), {
          message: `${await img.getAttribute('src')} did not load at ${width}×${height}`,
          timeout: 15_000,
        })
        .toEqual([width, height]);
    }
  });

  for (const width of OVERFLOW_WIDTHS) {
    test(`/participants at ${width}px: no page overflow, screenshots inside their cards`, async ({ page }) => {
      await expectNoOverflow(page, '/participants', width);
      const escaped = await page.locator(`${SECTION} .ob-acc__way`).evaluateAll((cards) =>
        cards.flatMap((card) => {
          const box = card.getBoundingClientRect();
          return [...card.querySelectorAll('img')]
            .map((img) => img.getBoundingClientRect())
            .filter((r) => r.left < box.left - 0.5 || r.right > box.right + 0.5)
            .map((r) => `${card.id}: img ${Math.round(r.left)}–${Math.round(r.right)} vs card ${Math.round(box.left)}–${Math.round(box.right)}`);
        }),
      );
      expect(escaped).toEqual([]);
    });

    test(`headings and columns hold inside the section at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/participants');
      await waitForWebfonts(page);
      await expectNoHeadingSpill(page, `/participants${SECTION} @${width}`);
      await expectNoColumnOverlap(page, `/participants${SECTION} @${width}`);
    });

    test(`axe finds nothing critical or serious in the section at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/participants');
      const results = await new AxeBuilder({ page })
        .include(SECTION)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});

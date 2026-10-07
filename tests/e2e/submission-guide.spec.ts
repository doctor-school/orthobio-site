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
 * - the permanent anchors land on their sections: #podat-materialy (the
 *   letters to registered participants link to it) and #zapolnit-zayavku (the
 *   sign-up success card and the pointer at the end of the first block do);
 * - «Как подать материалы» renders its two steps; step 2 is a numbered list of
 *   five sub-steps with the sign-in button right under the first, a
 *   screenshot after the third and the fourth, and a secondary note; the block
 *   ends with the pointer to «Как заполнить заявку»;
 * - «Как заполнить заявку» renders the eight cabinet steps and no sign-in;
 * - every date token was filled — the page never shows «{{…}}»;
 * - every screenshot actually loads from our bucket at its declared size, and
 *   none of them pushes the page or its card wider than the viewport.
 */
const SECTION = '#podat-materialy';
const FILL = '#zapolnit-zayavku';
/** Both guide blocks — the sweeps below cover the two together. */
const GUIDES = `${SECTION}, ${FILL}`;

const STEP_TITLES = ['1. Кто может подать материалы', '2. Как войти в кабинет'];

const FILL_TITLES = [
  '1. Кабинет «Мои заявки на Конгресс»',
  '2. Устный доклад',
  '3. Постерный доклад',
  '4. Тезисы',
  '5. Согласие на обработку персональных данных',
  '6. Сроки',
  '7. После отправки',
  '8. Частые вопросы',
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

  test('the permanent anchor #zapolnit-zayavku lands on «Как заполнить заявку»', async ({ page }) => {
    await page.goto(`/participants${FILL}`);
    const section = page.locator(FILL);
    await expect(section).toBeInViewport();
    await expect(section).toHaveAttribute('aria-labelledby', 'zapolnit-zayavku-title');
    await expect(section.locator('h2')).toHaveText(/^\s*Как\sзаполнить\sзаявку\s*$/);
  });

  test('renders the two sign-in steps, then «Как заполнить заявку» with the eight cabinet steps', async ({ page }) => {
    await page.goto('/participants');
    const titles = async (sel: string) =>
      (await page.locator(`${sel} h3`).allTextContents()).map((t) => unbreak(t).trim());
    expect(await titles(SECTION)).toEqual(STEP_TITLES);
    expect(await titles(FILL)).toEqual(FILL_TITLES);
    const ids = await page.locator(`${FILL} article`).evaluateAll((els) => els.map((el) => el.id));
    expect(ids).toEqual(FILL_TITLES.map((_, i) => `zapolnit-zayavku-${i + 1}`));
    // The fill-in block follows the sign-in block directly.
    const next = await page.locator(SECTION).evaluate((el) => el.nextElementSibling?.id);
    expect(next).toBe('zapolnit-zayavku');
  });

  test('«Как подать материалы» ends with the pointer to «Как заполнить заявку»', async ({ page }) => {
    await page.goto('/participants');
    const last = page.locator(`${SECTION} > :last-child`);
    const link = last.getByRole('link', { name: /^Дальше\s—\sкак заполнить заявку/ });
    await expect(link).toHaveAttribute('href', FILL);
    await expect(link).not.toHaveAttribute('target', /.*/);
    await link.click();
    await expect(page).toHaveURL(/\/participants#zapolnit-zayavku$/);
    await expect(page.locator(FILL)).toBeInViewport();
  });

  test('«Как заполнить заявку» has no sign-in — no button, no sign-in text', async ({ page }) => {
    await page.goto('/participants');
    const fill = page.locator(FILL);
    await expect(fill.locator('.ob-btn')).toHaveCount(0);
    await expect(fill.getByRole('link', { name: /Войти в кабинет/ })).toHaveCount(0);
    const text = unbreak((await fill.textContent()) ?? '');
    expect(text).not.toMatch(/Войти в кабинет|Отправить код|код для входа|Проверьте почту/);
    await expect(fill.locator('img[src*="/login-"], img[src*="/letter-"]')).toHaveCount(0);
  });

  test('step 2 walks the sign-in as five numbered sub-steps, the button under the first, a shot after the third, the screen and the letter after the fourth', async ({ page }) => {
    await page.goto('/participants');
    const items = page.locator('#podat-materialy-2 ol > li');
    await expect(items).toHaveCount(5);
    const shots = await items.evaluateAll((lis) => lis.map((li) => li.querySelectorAll('img').length));
    expect(shots).toEqual([0, 0, 1, 2, 0]);
    await expect(items.nth(2).locator('img')).toHaveAttribute('src', /\/2027\/submissions\/login-02-[a-z0-9-]+\.png$/);
    await expect(items.nth(3).locator('img').first()).toHaveAttribute('src', /\/2027\/submissions\/login-03-[a-z0-9-]+\.png$/);
    await expect(items.nth(3).locator('img').last()).toHaveAttribute('src', /\/2027\/submissions\/letter-code\.png$/);
    // The button sits right under the sub-step that names it, and only there.
    const buttons = await items.evaluateAll((lis) => lis.map((li) => li.querySelectorAll('.ob-btn').length));
    expect(buttons).toEqual([1, 0, 0, 0, 0]);
    const below = await items.nth(0).evaluate((li) => {
      const btn = li.querySelector('.ob-btn')!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(li.firstChild!);
      const text = range.getBoundingClientRect();
      return btn.top >= text.bottom - 1 && btn.top - text.bottom < 40;
    });
    expect(below).toBe(true);
    // List → the secondary note, in reading order; no button after the list.
    const order = await page
      .locator('#podat-materialy-2 > *')
      .evaluateAll((els) => els.map((el) => (el.matches('ol') ? 'list' : el.matches('.ob-btn') ? 'button' : el.matches('.ob-acc__note') ? 'note' : null)).filter(Boolean));
    expect(order).toEqual(['list', 'note']);
  });

  test('«Войти в кабинет» opens the Doctor.School sign-in by code in a new tab', async ({ page }) => {
    await page.goto('/participants');
    const button = page.locator('#podat-materialy-2 ol > li').first().getByRole('link', { name: /^Войти в кабинет/ });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('href', CABINET_LOGIN_URL);
    await expect(button).toHaveAttribute('target', '_blank');
    await expect(button).toHaveClass(/(^|\s)ob-btn(\s|$)/);
  });

  test('prints the dates from the site settings, never a raw token', async ({ page }) => {
    await page.goto('/participants');
    const text = unbreak(
      (await page.locator(SECTION).textContent()) + '\n' + (await page.locator(FILL).textContent()),
    );
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
    const imgs = page.locator(`:is(${GUIDES}) img`);
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
      const escaped = await page.locator(`:is(${GUIDES}) .ob-acc__way`).evaluateAll((cards) =>
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
        .include(FILL)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});

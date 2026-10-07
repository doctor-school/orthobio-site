import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { waitForWebfonts } from './_fonts';
import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';
import { expectNoOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';

/**
 * The submission guides (Issue #99): «Как подать материалы» on /participants
 * and «Как заполнить заявку» on its own page (owner, 2026-10-07: one task per
 * page — a reader who already signed in never scrolls past the sign-in). The
 * exact dates and the approved wording are values, asserted in
 * tests/unit/submission-guide.test.ts; this spec pins what only the rendered
 * pages can show:
 *
 * - the permanent anchor #podat-materialy lands on its section (the letters to
 *   registered participants link to it), and an old
 *   /participants#zapolnit-zayavku link is sent on to the filling page;
 * - «Как подать материалы» renders its two steps; step 2 is a numbered list of
 *   five sub-steps with the sign-in button right under the first, the «уже
 *   входили» line under the button, a screenshot after the third and the
 *   fourth, and a secondary note; the block ends with a button to the filling
 *   page;
 * - the filling page heads with one line pointing back to the sign-in, then the
 *   eight cabinet steps and no sign-in;
 * - every date token was filled — the pages never show «{{…}}»;
 * - every screenshot actually loads from our bucket at its declared size, and
 *   none of them pushes the page or its card wider than the viewport.
 */
const SECTION = '#podat-materialy';
const FILL = '#zapolnit-zayavku';
const FILL_PATH = '/participants/zapolnit-zayavku';

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

test.describe('«Как подать материалы» on /participants', () => {
  test('the permanent anchor lands on the section', async ({ page }) => {
    await page.goto(`/participants${SECTION}`);
    const section = page.locator(SECTION);
    await expect(section).toBeInViewport();
    await expect(section).toHaveAttribute('aria-labelledby', 'podat-materialy-title');
    await expect(section.locator('h2')).toHaveText(
      /^\s*Как\sподать\sматериалы\sна\sVIII\sКонгресс\s«Ортобиология\s2027»\s*$/,
    );
  });

  test('renders the two sign-in steps and no filling-in steps', async ({ page }) => {
    await page.goto('/participants');
    const titles = (await page.locator(`${SECTION} h3`).allTextContents()).map((t) => unbreak(t).trim());
    expect(titles).toEqual(STEP_TITLES);
    await expect(page.locator(FILL)).toHaveCount(0);
    await expect(page.locator('[id^="zapolnit-zayavku"]')).toHaveCount(0);
    // The one guide on the page; «Устный доклад» above is the requirements list, not a step.
    await expect(page.locator('.ob-sub')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /Мои заявки на Конгресс|Частые вопросы/ })).toHaveCount(0);
  });

  test('ends with a secondary button to the filling page, in this tab', async ({ page }) => {
    await page.goto('/participants');
    const last = page.locator(`${SECTION} > :last-child`);
    const link = last.getByRole('link', { name: /^Как заполнить заявку$/ });
    await expect(link).toHaveAttribute('href', FILL_PATH);
    await expect(link).toHaveClass(/(^|\s)ob-btn--secondary(\s|$)/);
    await expect(link).toContainText('→');
    await expect(link).not.toHaveAttribute('target', /.*/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${FILL_PATH}/?$`));
  });

  test('an old /participants#zapolnit-zayavku link reaches the filling page', async ({ page }) => {
    await page.goto(`/participants${FILL}`);
    await expect(page).toHaveURL(new RegExp(`${FILL_PATH}/?$`));
    await expect(page.locator('h1')).toHaveText(/Как\sзаполнить\sзаявку/);
    await page.goto(`/participants${FILL}-4`);
    await expect(page).toHaveURL(new RegExp(`${FILL_PATH}/?#zapolnit-zayavku-4$`));
    await expect(page.locator('#zapolnit-zayavku-4')).toBeInViewport();
  });

  test('step 2 walks the sign-in as five numbered sub-steps, the button under the first, a shot after the third, the screen and the letter after the fourth', async ({ page }) => {
    await page.goto('/participants');
    const items = page.locator('#podat-materialy-2 ol > li');
    await expect(items).toHaveCount(5);
    const shots = await items.evaluateAll((lis) => lis.map((li) => li.querySelectorAll('img').length));
    expect(shots).toEqual([0, 0, 1, 2, 0]);
    await expect(items.nth(2).locator('img')).toHaveAttribute('src', /\/2027\/submissions\/login-02-[a-z0-9-]+\.png$/);
    await expect(items.nth(3).locator('img').first()).toHaveAttribute('src', /\/2027\/submissions\/letter-code\.png$/);
    await expect(items.nth(3).locator('img').last()).toHaveAttribute('src', /\/2027\/submissions\/login-03-[a-z0-9-]+\.png$/);
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
    // Right under the button: no code is needed when the session is still on.
    const hint = items.nth(0).locator('.ob-btn + .ob-sub__hint');
    await expect(hint).toHaveText(
      /^\s*Если\sвы\sуже\sвходили\sв\sкабинет\sс\sэтого\sустройства,\sон\sоткроется\sсразу\s—\sкод\sне\sпонадобится\.\s*$/,
    );
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

  test('«Зарегистрироваться» opens the on-site registration form', async ({ page }) => {
    await page.goto('/participants');
    const link = page.locator('#podat-materialy-1').getByRole('link', { name: '«Зарегистрироваться»' });
    await expect(link).toHaveAttribute('href', '/registration');
    await expect(link).not.toHaveAttribute('target', /.*/);
  });
});

test.describe('«Как заполнить заявку» page', () => {
  test('is headed «Как заполнить заявку», under «Участникам» in the header', async ({ page }) => {
    await page.goto(FILL_PATH);
    await expect(page.locator('h1')).toHaveText(/^\s*Как\sзаполнить\sзаявку\s*$/);
    // The guide's own <h2> would repeat the page heading.
    await expect(page.locator(`${FILL} > h2`)).toHaveCount(0);
    const crumb = page.locator('.ob-crumb a');
    await expect(crumb).toHaveText('Участникам');
    await expect(crumb).toHaveAttribute('href', '/participants/');
    await expect(page.locator('.ob-nav a[aria-current="page"]')).toHaveText('Участникам');
  });

  test('opens with the one line on where to sign in, linking to «Как подать материалы»', async ({ page }) => {
    await page.goto(FILL_PATH);
    const intro = page.locator(`${FILL} > .ob-sub__intro`);
    await expect(intro).toHaveText(
      /^\s*Заявку\sзаполняют\sв\sличном\sкабинете\.\sЕсли\sвы\sещё\sне\sвошли\s—\sкак\sвойти\sв\sкабинет\.\s*$/,
    );
    const link = intro.getByRole('link', { name: 'как войти в кабинет' });
    await expect(link).toHaveAttribute('href', '/participants#podat-materialy');
    await expect(link).not.toHaveAttribute('target', /.*/);
    // It comes before the first step.
    const first = await page.locator(`${FILL} > *`).evaluateAll((els) => els[0]?.className);
    expect(first).toContain('ob-sub__intro');
    await link.click();
    await expect(page.locator(SECTION)).toBeInViewport();
  });

  test('renders the eight cabinet steps at their fixed ids', async ({ page }) => {
    await page.goto(FILL_PATH);
    const titles = (await page.locator(`${FILL} h2`).allTextContents()).map((t) => unbreak(t).trim());
    expect(titles).toEqual(FILL_TITLES);
    const ids = await page.locator(`${FILL} article`).evaluateAll((els) => els.map((el) => el.id));
    expect(ids).toEqual(FILL_TITLES.map((_, i) => `zapolnit-zayavku-${i + 1}`));
    await expect(page.locator(SECTION)).toHaveCount(0);
  });

  test('has no sign-in — no button, no sign-in text in the steps', async ({ page }) => {
    await page.goto(FILL_PATH);
    const steps = page.locator(`${FILL} .ob-sub__steps`);
    await expect(page.locator('main .ob-btn')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Войти в кабинет/ })).toHaveCount(0);
    const text = unbreak((await steps.textContent()) ?? '');
    expect(text).not.toMatch(/Войти в кабинет|Отправить код|код для входа|Проверьте почту|войти/);
    await expect(page.locator('img[src*="/login-"], img[src*="/letter-"]')).toHaveCount(0);
  });
});

test('prints the dates from the site settings, never a raw token', async ({ page }) => {
  await page.goto('/participants');
  let text = unbreak((await page.locator(SECTION).textContent()) ?? '');
  await page.goto(FILL_PATH);
  text += '\n' + unbreak((await page.locator(FILL).textContent()) ?? '');
  expect(text).not.toContain('{{');
  expect(text).not.toMatch(/приём открыт|открыт приём/);
  expect(text).toMatch(/«Забрать на исправление» до окончания приёма своего вида: устные доклады — до \d{1,2} [а-я]+ \d{4} года/);
  expect(text).toMatch(/устные доклады — до \d{1,2} [а-я]+ \d{4} года, постерные доклады и тезисы — до \d{1,2} [а-я]+ \d{4} года, до 23:59/);
  expect(text).toMatch(/устный доклад — \d{1,2} [а-я]+ \d{4} года; постерный доклад и тезисы — \d{1,2} [а-я]+ \d{4} года\./);
  expect(text).toMatch(/младше 40 лет на \d{1,2} [а-я]+ \d{4}: родились \d{2}\.\d{2}\.\d{4} или позже — можно; \d{2}\.\d{2}\.\d{4} или раньше — нельзя/);
});

/** Each guide: its page, its section and how many screenshots it carries (14 together). */
const GUIDE_PAGES = [
  { path: '/participants', section: SECTION, shots: 3 },
  { path: FILL_PATH, section: FILL, shots: 11 },
] as const;

for (const { path, section, shots } of GUIDE_PAGES) {
  test(`${path}: every screenshot loads from our bucket at its declared size`, async ({ page }) => {
    await page.goto(path);
    const imgs = page.locator(`${section} img`);
    await expect(imgs).toHaveCount(shots);
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
    test(`${path} at ${width}px: no page overflow, screenshots inside their cards`, async ({ page }) => {
      await expectNoOverflow(page, path, width);
      const escaped = await page.locator(`${section} .ob-acc__way`).evaluateAll((cards) =>
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

    test(`${path}: headings and columns hold inside the guide at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto(path);
      await waitForWebfonts(page);
      await expectNoHeadingSpill(page, `${path}${section} @${width}`);
      await expectNoColumnOverlap(page, `${path}${section} @${width}`);
    });

    test(`${path}: axe finds nothing critical or serious in the guide at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .include(section)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
}

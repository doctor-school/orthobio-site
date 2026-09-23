import { expect, test, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';
import { measureOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';

/**
 * The congress sign-up form (Issue #78) against a MOCKED platform: the preview
 * server has no `/api` proxy, so both endpoints are answered by `page.route`.
 * What is asserted is the site's half of the contract — the request body shape
 * (044 `CongressSignUpRequestSchema`) and how every response is rendered.
 *
 * The suite runs on `localhost`, one of the force-open hosts, so the form is
 * shown regardless of the date; the window rule itself is unit-tested
 * (`tests/unit/registration.test.ts`).
 */

const SPECIALTIES_URL = '**/api/v1/public/specialties';
const SIGN_UP_URL = '**/api/v1/congress/sign-up';

const OTHER = {
  id: '00000000-0000-4000-8000-000000000099',
  code: 'other',
  name: 'Другое / не медицинский работник',
  isOther: true,
};
const ORTHOPEDICS = {
  id: '6f1c2d3e-4b5a-4c6d-8e7f-901234567890',
  code: '031',
  name: 'Травматология и ортопедия',
  isOther: false,
};
const SPORTS = {
  id: '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d',
  code: '045',
  name: 'Спортивная медицина',
  isOther: false,
};

async function mockSpecialties(page: Page): Promise<void> {
  // «Другое» deliberately LAST here: putting it first is the form's job.
  await page.route(SPECIALTIES_URL, (route) =>
    route.fulfill({ json: { entries: [ORTHOPEDICS, SPORTS, OTHER], total: 3 } }),
  );
}

/** Answers the intake with `status`/`json` and records every request. */
async function mockSignUp(
  page: Page,
  status: number,
  json: unknown = status === 200 ? { status: 'accepted' } : {},
): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route(SIGN_UP_URL, (route) => {
    requests.push(route.request());
    return route.fulfill({ status, json });
  });
  return requests;
}

async function open(page: Page): Promise<void> {
  await mockSpecialties(page);
  await page.goto('/registration');
  await expect(page.locator('#signup-specialties option')).toHaveCount(3);
}

async function fillValid(page: Page, { patronymic = '' } = {}): Promise<void> {
  await page.getByLabel('Фамилия').fill('Иванов');
  await page.getByLabel('Имя', { exact: true }).fill('Иван');
  if (patronymic) await page.getByLabel(/Отчество/).fill(patronymic);
  await page.getByLabel('E-mail').fill('ivanov@example.com');
  await page.getByLabel('Телефон').fill('+7 (999) 123-45-67');
  await page.getByLabel('Специальность').fill(ORTHOPEDICS.name);
  await page.getByLabel('Место работы').fill('ГКБ № 1');
  await page.getByLabel('Город').fill('Москва');
  await page.getByLabel('Область').fill('Московская область');
  await page.getByLabel(/согласен/).check();
}

const submit = (page: Page) => page.getByRole('button', { name: 'Зарегистрироваться' }).click();

test.describe('sign-up form', () => {
  test('is shown on the local host, with «Другое» first in the specialty list', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Регистрация на конгресс' })).toBeVisible();
    await expect(page.getByText('23–24 апреля 2027 года, Москва')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Регистрация откроется/ })).toBeHidden();
    await expect(page.getByRole('heading', { name: /закрыта/ })).toBeHidden();

    const options = await page.locator('#signup-specialties option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    expect(options).toEqual([OTHER.name, ORTHOPEDICS.name, SPORTS.name]);
  });

  test('labels every field and marks required ones', async ({ page }) => {
    await open(page);
    for (const label of ['Фамилия', 'E-mail', 'Телефон', 'Специальность', 'Место работы', 'Город', 'Область']) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field, label).toHaveAttribute('required', '');
      await expect(field, label).toHaveAttribute('aria-required', 'true');
    }
    const patronymic = page.getByLabel(/Отчество/);
    await expect(patronymic).not.toHaveAttribute('required', '');
    await expect(page.getByText('(если есть)')).toBeVisible();
    await expect(page.getByRole('link', { name: 'политикой конфиденциальности' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  test('normalises the three name fields on blur, and only them', async ({ page }) => {
    await open(page);
    await page.getByLabel('Фамилия').fill('  салтыков   щедрин ');
    await page.getByLabel('Имя', { exact: true }).fill('анна-мария');
    await page.getByLabel(/Отчество/).fill("д'артаньян");
    await page.getByLabel('Город').fill('ростов-на-дону');
    await page.getByLabel('Область').focus();

    await expect(page.getByLabel('Фамилия')).toHaveValue('Салтыков Щедрин');
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Анна-Мария');
    await expect(page.getByLabel(/Отчество/)).toHaveValue("Д'Артаньян");
    await expect(page.getByLabel('Город')).toHaveValue('ростов-на-дону');
  });

  test('blocks an invalid phone with an inline error and sends nothing', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await page.getByLabel('Телефон').fill('12345');
    await submit(page);

    const phone = page.getByLabel('Телефон');
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toBeFocused();
    await expect(page.locator('#signup-phone-error')).toContainText('номер телефона');
    // The message is part of the field's description, so it is read with it.
    await expect(phone).toHaveAccessibleDescription(/номер телефона/);
    expect(requests).toHaveLength(0);
  });

  test('refuses a specialty typed outside the list', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await page.getByLabel('Специальность').fill('Хирург-волшебник');
    await submit(page);

    await expect(page.locator('#signup-specialty-error')).toHaveText('Выберите специальность из списка.');
    await expect(page.getByLabel('Специальность')).toBeFocused();
    expect(requests).toHaveLength(0);
  });

  test('reports every empty required field', async ({ page }) => {
    await open(page);
    await submit(page);
    await expect(page.locator('.ob-signup__error:visible')).toHaveCount(9);
    await expect(page.getByLabel('Фамилия')).toBeFocused();
  });

  test('posts the exact contract and shows the success card', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await submit(page);

    await expect(page.getByText('Заявка принята — письмо с подтверждением придёт на ivanov@example.com.')).toBeVisible();
    await expect(page.locator('[data-signup-form]')).toBeHidden();
    await expect(page.locator('[data-signup-success-text]')).toBeFocused();

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('application/json');
    const body = request.postDataJSON() as Record<string, unknown>;
    // Exact key set: no patronymic when empty, no consent version, no captcha
    // token when the build carries no sitekey.
    expect(Object.keys(body).sort()).toEqual(
      [
        'city',
        'contactPhone',
        'email',
        'firstName',
        'personalDataConsent',
        'region',
        'specialtyId',
        'surname',
        'workplace',
      ].sort(),
    );
    expect(body).toEqual({
      surname: 'Иванов',
      firstName: 'Иван',
      email: 'ivanov@example.com',
      contactPhone: '+7 (999) 123-45-67',
      specialtyId: ORTHOPEDICS.id,
      workplace: 'ГКБ № 1',
      city: 'Москва',
      region: 'Московская область',
      personalDataConsent: true,
    });
  });

  test('sends the patronymic when one is given, normalised', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page, { patronymic: 'иванович' });
    await page.getByLabel('Специальность').fill(OTHER.name);
    await submit(page);

    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.patronymic).toBe('Иванович');
    expect(body.specialtyId).toBe(OTHER.id);
  });

  test('switches to the «откроется» card on a not-yet-open refusal', async ({ page }) => {
    await mockSignUp(page, 422, { code: 'not-yet-open', opensAt: '2026-10-01T00:00:00+03:00' });
    await open(page);
    await fillValid(page);
    await submit(page);

    const heading = page.getByRole('heading', { name: 'Регистрация откроется 1 октября 2026 года, 00:00 (мск)' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.locator('[data-signup-form]')).toBeHidden();
  });

  test('switches to the «закрыта» card on a closed refusal', async ({ page }) => {
    await mockSignUp(page, 422, { code: 'closed' });
    await open(page);
    await fillValid(page);
    await submit(page);

    await expect(page.getByRole('heading', { name: 'Регистрация на конгресс закрыта' })).toBeVisible();
    await expect(page.locator('[data-signup-form]')).toBeHidden();
  });

  for (const status of [403, 500]) {
    test(`announces a generic error on HTTP ${status} and keeps the form usable`, async ({ page }) => {
      const requests = await mockSignUp(page, status);
      await open(page);
      await fillValid(page);
      await submit(page);

      const alert = page.getByRole('alert');
      await expect(alert).toContainText('Не удалось отправить заявку');
      const button = page.getByRole('button', { name: 'Зарегистрироваться' });
      await expect(button).toBeEnabled();
      await expect(page.locator('[data-signup-form]')).toHaveAttribute('aria-busy', 'false');

      await button.click();
      await expect.poll(() => requests.length).toBe(2);
    });
  }

  test('a validation refusal from the server is announced, not swallowed', async ({ page }) => {
    await mockSignUp(page, 422, { message: 'Bad Request' });
    await open(page);
    await fillValid(page);
    await submit(page);
    await expect(page.getByRole('alert')).toContainText('Проверьте введённые данные');
  });

  test('disables the button while the request is in flight', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(SIGN_UP_URL, async (route) => {
      await gate;
      await route.fulfill({ json: { status: 'accepted' } });
    });
    await open(page);
    await fillValid(page);
    await submit(page);

    await expect(page.locator('[data-signup-submit]')).toBeDisabled();
    await expect(page.locator('[data-signup-form]')).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(page.locator('[data-signup-success]')).toBeVisible();
  });

  test('reports an unreachable specialty list next to the field', async ({ page }) => {
    await page.route(SPECIALTIES_URL, (route) => route.fulfill({ status: 503, body: '' }));
    const requests = await mockSignUp(page, 200);
    await page.goto('/registration');
    await expect(page.locator('#signup-specialty-error')).toContainText('Не удалось загрузить');
    await fillValid(page);
    await submit(page);
    expect(requests).toHaveLength(0);
  });

  test('can be completed with the keyboard alone', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await page.getByLabel('Фамилия').focus();

    const typeAndTab = async (text: string) => {
      await page.keyboard.type(text);
      await page.keyboard.press('Tab');
    };
    await typeAndTab('петров');
    await typeAndTab('пётр');
    await typeAndTab('');
    await typeAndTab('petrov@example.com');
    await typeAndTab('8 999 765-43-21');
    await typeAndTab(SPORTS.name);
    await typeAndTab('Клиника');
    await typeAndTab('Тверь');
    await page.keyboard.type('Тверская область');
    await page.keyboard.press('Tab');

    await expect(page.getByLabel(/согласен/)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByLabel(/согласен/)).toBeChecked();
    // Past the policy link inside the label, onto the button.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Зарегистрироваться' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.surname).toBe('Петров');
    expect(body.firstName).toBe('Пётр');
    expect(body).not.toHaveProperty('patronymic');
    expect(body.specialtyId).toBe(SPORTS.id);
    expect(body.contactPhone).toBe('8 999 765-43-21');
  });

  // The error and success states are what the ladder in responsive.spec.ts
  // never renders: it measures the idle form. Same three guards plus axe.
  for (const width of OVERFLOW_WIDTHS) {
    test(`holds with every error shown at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await open(page);
      await submit(page);
      await expect(page.locator('.ob-signup__error:visible')).toHaveCount(9);

      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
      await expectNoHeadingSpill(page, `/registration errors @${width}`);
      await expectNoColumnOverlap(page, `/registration errors @${width}`);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
      expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
    });
  }

  test('keeps the three name fields on one row from md, and their inputs aligned', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await open(page);
    const tops = await Promise.all(
      ['Фамилия', 'Имя', 'Отчество'].map((label) =>
        page
          .getByLabel(label === 'Отчество' ? /Отчество/ : label, { exact: label !== 'Отчество' })
          .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      ),
    );
    expect(new Set(tops).size, `input tops ${tops.join(', ')}`).toBe(1);
  });
});

test.describe('sign-up form without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('states the opening date and shows no form', async ({ page }) => {
    await page.goto('/registration');
    await expect(page.getByRole('heading', { name: /Регистрация откроется 1 октября 2026 года/ })).toBeVisible();
    await expect(page.locator('[data-signup-form]')).toBeHidden();
  });
});

test.describe('privacy policy page', () => {
  test('publishes the owner text with its numbered sections as headings', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle(/^Политика в отношении обработки персональных данных/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Политика в отношении обработки персональных данных' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(8);
    await expect(page.getByRole('heading', { level: 2, name: '8. Заключительные положения' })).toBeVisible();
    // Verbatim: straight quotes and hyphens of the owner's file are NOT typeset.
    await expect(
      page.getByText(
        '8.3. Актуальная версия Политики в свободном доступе расположена в сети Интернет по адресу https://orthobio.ru/privacy.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('(далее – Оператор)', { exact: false })).toBeVisible();
  });
});

test('the home page leads to the registration form and still states the opening date', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Регистрация на конгресс' })).toHaveAttribute(
    'href',
    '/registration',
  );
  await expect(page.getByText('Регистрация откроется 1 октября 2026 года')).toBeVisible();
});

import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { expectNoColumnOverlap, expectNoHeadingSpill } from './_layout';
import { measureOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';
import { waitForWebfonts } from './_fonts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { registrationState, type RegistrationWindow } from '../../src/lib/registration';

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

// Shape and name of the live platform row (`GET /v1/public/specialties`).
const OTHER = {
  id: '00000000-0000-4000-8000-000000000099',
  code: 'drugoe',
  name: 'Другое',
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

const specialtyOptions = (page: Page) => page.locator('#signup-specialty-list [role="option"]');
const cityOptions = (page: Page) => page.locator('#signup-city-list [role="option"]');

/** Opens the page and waits for the specialty list, leaving no field focused. */
async function open(page: Page): Promise<void> {
  await mockSpecialties(page);
  await page.goto('/registration');
  const specialty = page.getByLabel('Специальность');
  await specialty.click();
  await expect(specialtyOptions(page)).toHaveCount(3);
  await page.keyboard.press('Escape');
  await specialty.blur();
}

async function fillValid(page: Page, { patronymic = '', city = true } = {}): Promise<void> {
  await page.getByLabel('Фамилия').fill('Иванов');
  await page.getByLabel('Имя', { exact: true }).fill('Иван');
  if (patronymic) await page.getByLabel(/Отчество/).fill(patronymic);
  await page.getByLabel('E-mail').fill('ivanov@example.com');
  await page.getByLabel('Телефон').fill('+7 (999) 123-45-67');
  // Typed in full, not picked: a full, unambiguous name commits itself and
  // closes its list, so the next field is reached as a mouse user would — no
  // Escape. The list assertions keep this helper honest about that.
  await page.getByLabel('Специальность').fill(ORTHOPEDICS.name);
  await expect(page.locator('#signup-specialty-list')).toBeHidden();
  await page.getByLabel('Место работы').fill('ГКБ № 1');
  if (city) {
    await page.getByLabel('Населённый пункт').fill('Москва');
    await expect(page.locator('#signup-city-list')).toBeHidden();
  }
  await page.getByLabel(/согласен/).check();
}

/**
 * Scrolls into view, then a real mouse press and release at the centre: the
 * pointer lands on whatever is on top there, as a person's would (a locator
 * click refuses an element another one covers).
 */
async function clickAt(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The widths a list covers different fields at: the narrowest and a desktop. */
const MOUSE_WIDTHS = [360, 1280] as const;

/** Submits the form and returns the place the platform received. */
async function submittedPlace(page: Page, requests: Request[]): Promise<{ city: unknown; region: unknown }> {
  await submit(page);
  await expect(page.locator('[data-signup-success]')).toBeVisible();
  expect(requests).toHaveLength(1);
  const body = requests[0].postDataJSON() as Record<string, unknown>;
  return { city: body.city, region: body.region };
}

/** Focuses «Населённый пункт» and waits for the directory it loads. */
async function focusCity(page: Page): Promise<void> {
  const city = page.getByLabel('Населённый пункт');
  await city.focus();
  // The list can only open once the directory is in: ArrowDown until it does.
  await expect(async () => {
    await page.keyboard.press('ArrowDown');
    await expect(cityOptions(page).first()).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.keyboard.press('Escape');
}

/**
 * The window as configured. `src/config/site.ts` reads `import.meta.env` (a
 * Vite-only object), so it cannot be imported under Playwright; the two
 * instants are read from its source instead, which keeps this suite on the
 * configured values without a second copy. A key may wrap its default in an
 * env override (`closesAt: instantFromEnv('…', import.meta.env.…, '<iso>')`,
 * Issue #98), so the reader takes the first ISO instant after the key — the
 * default the e2e build runs with, since it sets no override.
 */
const REGISTRATION_WINDOW: RegistrationWindow = (() => {
  const source = readFileSync(fileURLToPath(new URL('../../src/config/site.ts', import.meta.url)), 'utf8');
  const block = /export const REGISTRATION_WINDOW = \{([^}]*)\}/.exec(source)![1];
  const read = (key: string) =>
    new RegExp(`${key}:[\\s\\S]*?'(\\d{4}-\\d{2}-\\d{2}T[^']+)'`).exec(block)![1];
  return { opensAt: read('opensAt'), closesAt: read('closesAt') };
})();

/**
 * A host that is NOT force-open, so the dated states can be seen: the page is
 * served as orthobio.test by proxying to the preview server, with the device
 * clock and the HEAD `Date` header (the module's server-clock re-judge) both
 * set to `at`.
 */
const PROD_LIKE = 'http://orthobio.test';
async function serveAsProduction(page: Page, baseURL: string, at: Date): Promise<void> {
  await page.clock.setFixedTime(at);
  await page.route(`${PROD_LIKE}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'HEAD') {
      await route.fulfill({ status: 200, headers: { Date: at.toUTCString() }, body: '' });
      return;
    }
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}

/**
 * The three dated states, each at an instant inside it (`serveAsProduction`),
 * derived from the window so moving a bound in config cannot strand a fixture
 * in the wrong state: a day before opening, a day after, a day after closing.
 */
const DAY_MS = 86_400_000;
const atOffset = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();
const DATED_STATES = [
  { name: 'not-yet-open', at: atOffset(REGISTRATION_WINDOW.opensAt, -DAY_MS) },
  { name: 'open', at: atOffset(REGISTRATION_WINDOW.opensAt, DAY_MS) },
  { name: 'closed', at: atOffset(REGISTRATION_WINDOW.closesAt!, DAY_MS) },
] as const;

/** Blocks the form's module, leaving only the markup and the pre-paint snippet. */
const blockSignupModule = (page: Page) =>
  page.route('**/_astro/SignupForm*.js', (route) => route.abort());

const submit = (page: Page) => page.getByRole('button', { name: 'Зарегистрироваться' }).click();

test.describe('sign-up form', () => {
  test('is shown on the local host, with «Другое» pinned last in the specialty list', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Регистрация на конгресс' })).toBeVisible();
    await expect(page.getByText('23–24 апреля 2027 года, Москва')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Регистрация откроется/ })).toBeHidden();
    await expect(page.getByRole('heading', { name: /закрыта/ })).toBeHidden();

    // Design: «Другое» pinned at the foot, under a hairline, the rest in the
    // platform's order.
    await page.getByLabel('Специальность').click();
    await expect(specialtyOptions(page)).toHaveText([ORTHOPEDICS.name, SPORTS.name, OTHER.name]);
    await expect(specialtyOptions(page).last()).toHaveClass(/ob-signup__opt--pinned/);
    // The hint names the option exactly as the list shows it.
    await expect(page.locator('#signup-specialty-hint')).toContainText(`«${OTHER.name}»`);
  });

  test('labels every field and marks required ones', async ({ page }) => {
    await open(page);
    for (const label of ['Фамилия', 'E-mail', 'Телефон', 'Специальность', 'Место работы', 'Населённый пункт']) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field, label).toHaveAttribute('required', '');
      await expect(field, label).toHaveAttribute('aria-required', 'true');
    }
    // «Регион» is asked only for a place the directory does not resolve.
    await expect(page.getByLabel('Регион')).toBeHidden();
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
    await page.getByLabel('Населённый пункт').fill('минск');
    await page.getByLabel('Место работы').focus();

    await expect(page.getByLabel('Фамилия')).toHaveValue('Салтыков Щедрин');
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Анна-Мария');
    await expect(page.getByLabel(/Отчество/)).toHaveValue("Д'Артаньян");
    await expect(page.getByLabel('Населённый пункт')).toHaveValue('минск');
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

  test('blocks an address the platform would refuse, next to the field', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await page.getByLabel('E-mail').fill('ivanov@clinic');
    await submit(page);

    await expect(page.getByLabel('E-mail')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('E-mail')).toBeFocused();
    await expect(page.locator('#signup-email-error')).toContainText('name@example.com');
    expect(requests).toHaveLength(0);
  });

  test('resolves a fragment that names exactly one specialty', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await page.getByLabel('Специальность').fill('ортопед');
    await page.getByLabel('Место работы').focus();
    await expect(page.getByLabel('Специальность')).toHaveValue(ORTHOPEDICS.name);
    await submit(page);

    await expect(page.locator('[data-signup-success]')).toBeVisible();
    expect((requests[0].postDataJSON() as Record<string, unknown>).specialtyId).toBe(ORTHOPEDICS.id);
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
    await expect(page.locator('.ob-signup__error:visible')).toHaveCount(8);
    await expect(page.getByLabel('Фамилия')).toBeFocused();
  });

  test('posts the exact contract and shows the success card', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await submit(page);

    const title = page.getByRole('heading', { level: 2, name: 'Заявка принята' });
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    await expect(title).toHaveAccessibleDescription(
      'Письмо-подтверждение придёт на ivanov@example.com в\u00a0течение нескольких минут. Если его нет\u00a0— проверьте папку «Спам».',
    );
    await expect(page.locator('[data-signup-form]')).toBeHidden();
    // The form's own heading leaves with the form: the card now says one thing.
    await expect(page.getByRole('heading', { name: 'Регистрация на конгресс', exact: true })).toBeHidden();

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
      region: 'г. Москва',
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

    const heading = page.getByRole('heading', { name: 'Регистрация откроется 1 октября 2026 года, 00:00 (МСК)' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.locator('[data-signup-form]')).toBeHidden();
  });

  test('offers the Doctor.School channel on the «откроется» card, in a new tab', async ({ page }) => {
    await mockSignUp(page, 422, { code: 'not-yet-open' });
    await open(page);
    await fillValid(page);
    await submit(page);

    const card = page.locator('[data-signup-state="not-yet-open"]');
    const cta = card.getByRole('link', { name: /^Узнать первым/ });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', 'https://t.me/DoctorSchool');
    await expect(cta).toHaveAttribute('target', '_blank');
    await expect(cta).toHaveAttribute('rel', 'noopener');
    await expect(cta).toHaveAccessibleName(/открывается в новой вкладке/);
    await expect(cta).toHaveClass(/ob-btn--accent/);
  });

  test('switches to the «закрыта» card on a closed refusal', async ({ page }) => {
    await mockSignUp(page, 422, { code: 'closed' });
    await open(page);
    await fillValid(page);
    await submit(page);

    await expect(page.getByRole('heading', { name: 'Регистрация на конгресс закрыта' })).toBeVisible();
    await expect(page.locator('[data-signup-form]')).toBeHidden();
  });

  // Not the participant's to fix: a gated upstream (401), a captcha refusal
  // on a build without a widget (403), a platform-side configuration refusal
  // (422 sign-up-unavailable) and a server error all get the same line.
  const GENERIC: { status: number; json?: unknown }[] = [
    { status: 401 },
    { status: 403 },
    { status: 422, json: { code: 'sign-up-unavailable' } },
    { status: 500 },
  ];
  for (const { status, json } of GENERIC) {
    const label = json ? `${status} ${JSON.stringify(json)}` : String(status);
    test(`announces a generic error on HTTP ${label} and keeps the form usable`, async ({ page }) => {
      const requests = await mockSignUp(page, status, json);
      await open(page);
      await fillValid(page);
      await submit(page);

      const alert = page.getByRole('alert');
      await expect(alert).toHaveText(/^Регистрация временно недоступна, попробуйте через несколько минут/);
      await expect(alert).not.toContainText('Проверьте введённые данные');
      const button = page.getByRole('button', { name: 'Зарегистрироваться' });
      await expect(button).toBeEnabled();
      await expect(page.locator('[data-signup-form]')).toHaveAttribute('aria-busy', 'false');

      await button.click();
      await expect.poll(() => requests.length).toBe(2);
    });
  }

  test('a validation refusal from the server (400) is announced, not swallowed', async ({ page }) => {
    // The platform's ZodValidationPipe answers invalid bodies with 400.
    await mockSignUp(page, 400, { message: 'Validation failed' });
    await open(page);
    await fillValid(page);
    await submit(page);
    await expect(page.getByRole('alert')).toContainText('Проверьте введённые данные');
  });

  test('a rate-limit refusal (429) asks the participant to wait', async ({ page }) => {
    await mockSignUp(page, 429);
    await open(page);
    await fillValid(page);
    await submit(page);
    await expect(page.getByRole('alert')).toContainText('Подождите несколько минут');
  });

  test('keeps the alert live region in the tree, empty, before any refusal', async ({ page }) => {
    await open(page);
    const region = page.locator('[data-signup-alert]');
    await expect(region).toHaveAttribute('role', 'alert');
    await expect(region).not.toHaveAttribute('hidden', /.*/);
    await expect(region).toHaveText('');
    expect(await region.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
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
    await typeAndTab('Клиника');
    await typeAndTab(SPORTS.name);
    await typeAndTab('Тверь');

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
    expect(body.city).toBe('Тверь');
    expect(body.region).toBe('Тверская область');
  });

  test('loads the settlement directory lazily, from a hashed same-origin asset', async ({ page }) => {
    const directory: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('settlements')) directory.push(req.url());
    });
    await open(page);
    expect(directory).toEqual([]);
    await focusCity(page);
    expect(directory).toHaveLength(1);
    expect(new URL(directory[0]).pathname).toMatch(/^\/_astro\/settlements\.[\w-]+\.json$/);
  });

  test('fills the region from a directory pick and sends city and region apart', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await focusCity(page);
    await page.getByLabel('Населённый пункт').fill('г. химки');
    await page.getByLabel('Место работы').focus();
    // The name in the field, the region under it (design).
    await expect(page.getByLabel('Населённый пункт')).toHaveValue('Химки');
    await expect(page.locator('#signup-city-hint')).toHaveText('Московская область');
    await expect(page.locator('#signup-city-hint')).toBeVisible();
    await expect(page.getByLabel('Регион')).toBeHidden();
    await submit(page);

    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.city).toBe('Химки');
    expect(body.region).toBe('Московская область');
  });

  test('accepts a place outside the directory as free text, with the region asked separately', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await focusCity(page);
    await page.getByLabel('Населённый пункт').fill('Минск');
    // Revealed while typing, before the participant leaves the field.
    const region = page.getByLabel('Регион');
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#signup-region-hint')).toHaveText(
      'Этого населённого пункта нет в\u00a0списке\u00a0— укажите регион или страну.',
    );
    await expect(page.locator('[data-region-status]')).toContainText('Добавлено поле «Регион».');

    await submit(page);
    await expect(page.locator('#signup-region-error')).toHaveText('Заполните это поле.');
    await expect(region).toBeFocused();
    expect(requests).toHaveLength(0);

    await region.fill('Беларусь');
    await submit(page);
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.city).toBe('Минск');
    expect(body.region).toBe('Беларусь');
  });

  test('asks to pick the region for a name found in several regions', async ({ page }) => {
    await open(page);
    await focusCity(page);
    await page.getByLabel('Населённый пункт').fill('Кировск');
    await expect(page.getByLabel('Регион')).toBeVisible();
    await expect(page.locator('#signup-region-hint')).toContainText('в\u00a0нескольких регионах');

    await page.getByLabel('Населённый пункт').fill('Кировск — Мурманская область');
    await expect(page.getByLabel('Регион')).toBeHidden();
    await expect(page.locator('[data-region-status]')).toBeEmpty();
  });

  test('asks for the region when the directory cannot be loaded', async ({ page }) => {
    await page.route('**/_astro/settlements.*.json', (route) => route.fulfill({ status: 503, body: '' }));
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await expect(page.getByLabel(/согласен/)).toBeChecked();
    await submit(page);
    await expect(page.getByLabel('Регион')).toBeFocused();
    expect(requests).toHaveLength(0);

    await page.getByLabel('Регион').fill('г. Москва');
    await submit(page);
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.city).toBe('Москва');
    expect(body.region).toBe('г. Москва');
  });

  // The «Регион» reveal once ran on blur, and the layout shift swallowed the
  // very press that caused the blur. These pin the press and the Tab down.
  for (const width of [390, 1280]) {
    test(`a click on the consent box right after an unlisted place ticks it at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await focusCity(page);
      await page.getByLabel('Населённый пункт').fill('Минск');
      await page.getByLabel(/согласен/).click();
      await expect(page.getByLabel(/согласен/)).toBeChecked();
    });
  }

  test('Tab from an unlisted place lands on the revealed «Регион»', async ({ page }) => {
    await open(page);
    await focusCity(page);
    await page.keyboard.type('Минск');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Регион')).toBeFocused();
  });

  test('Tab after a directory match hides «Регион» without losing focus', async ({ page }) => {
    await open(page);
    await focusCity(page);
    await page.keyboard.type('Минск');
    await expect(page.getByLabel('Регион')).toBeVisible();
    await page.getByLabel('Населённый пункт').fill('');
    await page.keyboard.type('Комсомольск-на-А');
    await expect(page.getByLabel('Регион')).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(/согласен/)).toBeFocused();
    await expect(page.getByLabel('Населённый пункт')).toHaveValue('Комсомольск-на-Амуре');
    await expect(page.locator('#signup-city-hint')).toHaveText('Хабаровский край');
  });

  test('judges a city value that arrived without a focus against the directory', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page, { city: false });
    // As a form restore on back navigation does: a value, no focus, no input event.
    await page.getByLabel('Населённый пункт').evaluate((el: HTMLInputElement) => {
      el.value = 'Химки';
    });
    await submit(page);
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.region).toBe('Московская область');
  });

  // The error and success states are what the ladder in responsive.spec.ts
  // never renders: it measures the idle form. Same three guards plus axe.
  for (const width of OVERFLOW_WIDTHS) {
    test(`holds with every error shown at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await open(page);
      // A place outside the directory, so the «Регион» field is measured too:
      // its error replaces the one the empty «Населённый пункт» would show.
      await page.getByLabel('Населённый пункт').fill('Минск');
      await submit(page);
      await expect(page.getByLabel('Регион')).toBeVisible();
      await expect(page.locator('.ob-signup__error:visible')).toHaveCount(8);

      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
      await expectNoHeadingSpill(page, `/registration errors @${width}`);
      await expectNoColumnOverlap(page, `/registration errors @${width}`);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
      expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
    });
  }

  test('keeps the three name fields on one row from sm, and their inputs aligned', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await open(page);
    await waitForWebfonts(page);
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

// ── Page design (Issue #82) ────────────────────────────────────────────────
// The responsive and a11y ladders (responsive.spec.ts, a11y.spec.ts) already
// walk /registration at every width; these pin what they cannot see — the
// VALUES the page prints, the column order, and the states they never render.
// Issue #88: the list fields are the design's own combobox, not a native
// <datalist>. The list suggests; what a value resolves to is still the form's
// (tests above), so these pin the widget itself.
test.describe('sign-up list fields', () => {
  test('typing opens the specialty list, highlights the typed part and keeps «Другое» last', async ({ page }) => {
    await open(page);
    const input = page.getByRole('combobox', { name: 'Специальность' });
    const list = page.getByRole('listbox', { name: 'Список специальностей' });
    await expect(list).toBeHidden();
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    await input.pressSequentially('орт');
    await expect(list).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toHaveAttribute('aria-controls', 'signup-specialty-list');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    // Both names contain «орт»; «Другое» stays pinned whatever was typed.
    await expect(specialtyOptions(page)).toHaveText([ORTHOPEDICS.name, SPORTS.name, OTHER.name]);
    await expect(specialtyOptions(page).first().locator('b')).toHaveText('орт');
    // The first option is active, and the input says so.
    const first = await specialtyOptions(page).first().getAttribute('id');
    await expect(input).toHaveAttribute('aria-activedescendant', first!);
    await expect(specialtyOptions(page).first()).toHaveClass(/is-active/);
  });

  test('picks an option with the arrows and Enter, and sends its id', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    const input = page.getByRole('combobox', { name: 'Специальность' });
    await input.fill('');
    await input.pressSequentially('орт');
    await page.keyboard.press('ArrowDown');
    const second = await specialtyOptions(page).nth(1).getAttribute('id');
    await expect(input).toHaveAttribute('aria-activedescendant', second!);
    await page.keyboard.press('Enter');

    await expect(input).toHaveValue(SPORTS.name);
    await expect(page.getByRole('listbox', { name: 'Список специальностей' })).toBeHidden();
    await expect(input).not.toHaveAttribute('aria-activedescendant', /.*/);
    await expect(input).toBeFocused();
    // Enter picked; it did not submit the form.
    expect(requests).toHaveLength(0);

    await submit(page);
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    expect((requests[0].postDataJSON() as Record<string, unknown>).specialtyId).toBe(SPORTS.id);
  });

  test('ArrowUp stops at the first option, Escape closes and keeps the typed text', async ({ page }) => {
    await open(page);
    const input = page.getByRole('combobox', { name: 'Специальность' });
    await input.pressSequentially('орт');
    await page.keyboard.press('ArrowUp');
    await expect(specialtyOptions(page).first()).toHaveClass(/is-active/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Список специальностей' })).toBeHidden();
    await expect(input).toHaveValue('орт');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('says nothing matched, and still offers «Другое»', async ({ page }) => {
    await open(page);
    await page.getByRole('combobox', { name: 'Специальность' }).pressSequentially('Хирург-волшебник');
    await expect(page.locator('#signup-specialty-list')).toContainText('Ничего не найдено');
    await expect(specialtyOptions(page)).toHaveText([OTHER.name]);
  });

  test('does not say «nothing found» above «Другое» when «Другое» is what was typed', async ({ page }) => {
    await open(page);
    await page.getByRole('combobox', { name: 'Специальность' }).pressSequentially('Друг');
    await expect(specialtyOptions(page)).toHaveText([OTHER.name]);
    await expect(page.locator('#signup-specialty-list')).not.toContainText('Ничего не найдено');
  });

  test('marks only the active option as aria-selected', async ({ page }) => {
    await open(page);
    await page.getByRole('combobox', { name: 'Специальность' }).pressSequentially('орт');
    const selected = () =>
      specialtyOptions(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-selected')));
    expect(await selected()).toEqual(['true', null, null]);
    await page.keyboard.press('ArrowDown');
    expect(await selected()).toEqual([null, 'true', null]);
  });

  // PR #89 review: an open list hangs over the fields below it, so a click
  // aimed at the next field landed on an option and picked it. A full name
  // now commits itself and closes the list as it is typed.
  test('a full specialty name commits itself, and a click on the next field keeps it', async ({ page }) => {
    await open(page);
    const input = page.getByRole('combobox', { name: 'Специальность' });
    // Case and spacing as a person might type them.
    await input.pressSequentially('травматология и  ортопедия');
    await expect(page.getByRole('listbox', { name: 'Список специальностей' })).toBeHidden();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toHaveValue(ORTHOPEDICS.name);
    await expect(page.locator('[data-specialty-id]')).toHaveValue(ORTHOPEDICS.id);

    const city = page.getByRole('combobox', { name: 'Населённый пункт' });
    await clickAt(page, city);
    await expect(city).toBeFocused();
    await expect(input).toHaveValue(ORTHOPEDICS.name);
    await expect(page.locator('[data-specialty-id]')).toHaveValue(ORTHOPEDICS.id);
  });

  // Which field an open list covers depends on the width (PR #89 review,
  // round 2), so the mouse paths run at the narrowest and a desktop width,
  // and each ends on what is SENT: the city has no hidden id, the payload is
  // built from the form's own resolved place.
  for (const width of MOUSE_WIDTHS) {
    test.describe(`mouse path at ${width}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
      });

      test('a full, unambiguous place commits itself, and a click on consent ticks it', async ({ page }) => {
        const requests = await mockSignUp(page, 200);
        await open(page);
        await fillValid(page, { city: false });
        const consent = page.getByLabel(/согласен/);
        await consent.uncheck();
        await focusCity(page);
        const input = page.getByRole('combobox', { name: 'Населённый пункт' });
        await input.pressSequentially('химки');
        await expect(page.getByRole('listbox', { name: 'Список населённых пунктов' })).toBeHidden();
        await expect(input).toHaveValue('Химки');
        await expect(page.locator('#signup-city-hint')).toHaveText('Московская область');

        await clickAt(page, consent);
        await expect(consent).toBeChecked();
        await expect(input).toHaveValue('Химки');
        await expect(page.locator('#signup-city-hint')).toHaveText('Московская область');
        expect(await submittedPlace(page, requests)).toEqual({ city: 'Химки', region: 'Московская область' });
      });

      // Round 2: a same-named place typed with its region resolved the place
      // but left every «Кировск» row open over consent, so the click there
      // picked another region.
      test('a shared name typed with its region commits itself, and a click on consent ticks it', async ({
        page,
      }) => {
        const requests = await mockSignUp(page, 200);
        await open(page);
        await fillValid(page, { city: false });
        const consent = page.getByLabel(/согласен/);
        await consent.uncheck();
        await focusCity(page);
        const input = page.getByRole('combobox', { name: 'Населённый пункт' });
        await input.pressSequentially('Кировск, Мурманская область');
        await expect(page.getByRole('listbox', { name: 'Список населённых пунктов' })).toBeHidden();
        await expect(input).toHaveValue('Кировск');
        await expect(page.locator('#signup-city-hint')).toHaveText('Мурманская область');

        await clickAt(page, consent);
        await expect(consent).toBeChecked();
        await expect(input).toHaveValue('Кировск');
        await expect(page.locator('#signup-city-hint')).toHaveText('Мурманская область');
        await expect(page.getByLabel('Регион')).toBeHidden();
        expect(await submittedPlace(page, requests)).toEqual({ city: 'Кировск', region: 'Мурманская область' });
      });

      test('a name found in several regions keeps the list open, and a click on a row applies it', async ({
        page,
      }) => {
        const requests = await mockSignUp(page, 200);
        await open(page);
        await fillValid(page, { city: false });
        await focusCity(page);
        const input = page.getByRole('combobox', { name: 'Населённый пункт' });
        await input.pressSequentially('Кировск');
        const list = page.getByRole('listbox', { name: 'Список населённых пунктов' });
        await expect(list).toBeVisible();
        await expect(page.getByLabel('Регион')).toBeVisible();
        // The exact name ranks before the longer ones it begins («Кировское»).
        await expect(cityOptions(page).first().locator('span').first()).toHaveText('Кировск');
        const sub = cityOptions(page).first().locator('.ob-signup__opt-sub');
        // Its tail is spaced off the name in the text itself, not by the layout.
        expect(await sub.evaluate((el) => el.textContent)).toMatch(/^\u00a0— /);

        const option = cityOptions(page)
          .filter({ hasText: 'Ленинградская область' })
          .filter({ has: page.getByText('Кировск', { exact: true }) });
        await clickAt(page, option);
        await expect(list).toBeHidden();
        await expect(input).toHaveValue('Кировск');
        await expect(page.locator('#signup-city-hint')).toHaveText('Ленинградская область');
        await expect(page.locator('#signup-city-hint')).toBeVisible();
        await expect(page.getByLabel('Регион')).toBeHidden();
        expect(await submittedPlace(page, requests)).toEqual({ city: 'Кировск', region: 'Ленинградская область' });
      });

      // A press outside the list is not swallowed: it closes the list, reaches
      // its own target, and commits nothing for a place still being typed. (A
      // list this long covers the consent box, as any open dropdown covers what
      // is under it; the press goes to a field the list leaves visible.)
      test('a partial place, then a click elsewhere: the list closes and nothing is picked', async ({ page }) => {
        const requests = await mockSignUp(page, 200);
        await open(page);
        await fillValid(page, { city: false });
        await page.getByLabel(/согласен/).uncheck();
        await focusCity(page);
        const input = page.getByRole('combobox', { name: 'Населённый пункт' });
        await input.pressSequentially('Кировс');
        const list = page.getByRole('listbox', { name: 'Список населённых пунктов' });
        await expect(list).toBeVisible();

        const workplace = page.getByLabel('Место работы');
        await clickAt(page, workplace);
        await expect(list).toBeHidden();
        await expect(workplace).toBeFocused();
        await expect(input).toHaveValue('Кировс');
        await expect(page.locator('#signup-city-hint')).toBeHidden();

        const consent = page.getByLabel(/согласен/);
        await clickAt(page, consent);
        await expect(consent).toBeChecked();

        // Still no place from the list: the region is asked for, nothing is sent.
        await submit(page);
        await expect(page.getByLabel('Регион')).toBeVisible();
        await expect(page.locator('#signup-region-error')).toHaveText('Заполните это поле.');
        expect(requests).toHaveLength(0);
      });
    });
  }

  // «Бор» is a whole name and commits; typing on must drop it, not keep a
  // stale pick under a longer name.
  test('typing past a committed name drops it, and the longer name is what is sent', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page, { city: false });
    await focusCity(page);
    const input = page.getByRole('combobox', { name: 'Населённый пункт' });
    const hint = page.locator('#signup-city-hint');
    await input.pressSequentially('Бор');
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveText('Воронежская область');

    await input.pressSequentially('и');
    await expect(input).toHaveValue('Бори');
    await expect(hint).toBeHidden();

    await input.pressSequentially('соглебск');
    await expect(input).toHaveValue('Борисоглебск');
    await expect(hint).toHaveText('Воронежская область');
    expect(await submittedPlace(page, requests)).toEqual({ city: 'Борисоглебск', region: 'Воронежская область' });
  });

  test('editing a picked place drops the pick, and submit asks for the region', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page, { city: false });
    await focusCity(page);
    const input = page.getByRole('combobox', { name: 'Населённый пункт' });
    await input.pressSequentially('Кировск');
    await cityOptions(page)
      .filter({ hasText: 'Ленинградская область' })
      .filter({ has: page.getByText('Кировск', { exact: true }) })
      .click();
    await expect(page.locator('#signup-city-hint')).toHaveText('Ленинградская область');

    // The same letters retyped: the text reads «Кировск» again, but as the
    // shared name, not the pick.
    await input.press('Backspace');
    await input.pressSequentially('к');
    await expect(input).toHaveValue('Кировск');
    await expect(page.locator('#signup-city-hint')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.getByLabel('Место работы').focus();
    await submit(page);
    await expect(page.getByLabel('Регион')).toBeVisible();
    await expect(page.locator('#signup-region-error')).toHaveText('Заполните это поле.');
    expect(requests).toHaveLength(0);
  });

  test('Tab closes the list without picking', async ({ page }) => {
    await open(page);
    const input = page.getByRole('combobox', { name: 'Специальность' });
    await input.pressSequentially('орт');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('listbox', { name: 'Список специальностей' })).toBeHidden();
    await expect(input).toHaveValue('орт');
    await expect(page.locator('[data-specialty-id]')).toHaveValue('');
  });

  test('a click outside closes the list', async ({ page }) => {
    await open(page);
    await page.getByRole('combobox', { name: 'Специальность' }).pressSequentially('орт');
    await expect(page.getByRole('listbox', { name: 'Список специальностей' })).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(page.getByRole('listbox', { name: 'Список специальностей' })).toBeHidden();
  });

  test('a click on an option picks it', async ({ page }) => {
    await open(page);
    const input = page.getByRole('combobox', { name: 'Специальность' });
    await input.pressSequentially('спорт');
    await specialtyOptions(page).filter({ hasText: SPORTS.name }).click();
    await expect(input).toHaveValue(SPORTS.name);
    await expect(page.locator('[data-specialty-id]')).toHaveValue(SPORTS.id);
    await expect(input).toBeFocused();
  });

  test('lists places as «Город — Регион» and shows the picked region under the field', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page, { city: false });
    await focusCity(page);
    const input = page.getByRole('combobox', { name: 'Населённый пункт' });
    await input.pressSequentially('химк');
    const option = cityOptions(page).filter({ hasText: 'Московская область' }).filter({ hasText: /^Химки/ });
    await expect(option.locator('span').first()).toHaveText('Химки');
    await expect(option.locator('b')).toHaveText('Химк');
    expect(await option.locator('.ob-signup__opt-sub').evaluate((el) => el.textContent)).toBe(
      '\u00a0— Московская область',
    );

    await option.click();
    await expect(input).toHaveValue('Химки');
    const hint = page.locator('#signup-city-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Московская область');
    await expect(input).toHaveAttribute('aria-describedby', /signup-city-hint/);
    await expect(page.getByLabel('Регион')).toBeHidden();

    await submit(page);
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.city).toBe('Химки');
    expect(body.region).toBe('Московская область');
  });

  test('a pick settles a name found in several regions, and survives the blur', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page, { city: false });
    await focusCity(page);
    const input = page.getByRole('combobox', { name: 'Населённый пункт' });
    await input.pressSequentially('Кировск');
    await expect(page.getByLabel('Регион')).toBeVisible();

    await cityOptions(page).filter({ hasText: 'Мурманская область' }).click();
    await expect(input).toHaveValue('Кировск');
    await expect(page.locator('#signup-city-hint')).toHaveText('Мурманская область');
    await expect(page.getByLabel('Регион')).toBeHidden();

    await page.getByLabel('Место работы').focus();
    await expect(input).toHaveValue('Кировск');
    await submit(page);
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    const body = requests[0].postDataJSON() as Record<string, unknown>;
    expect(body.city).toBe('Кировск');
    expect(body.region).toBe('Мурманская область');
  });

  test('a place outside the directory closes the list and asks for the region', async ({ page }) => {
    await open(page);
    await focusCity(page);
    await page.getByRole('combobox', { name: 'Населённый пункт' }).pressSequentially('Минск');
    await expect(page.getByRole('listbox', { name: 'Список населённых пунктов' })).toBeHidden();
    await expect(page.locator('#signup-city-hint')).toBeHidden();
    await expect(page.getByLabel('Регион')).toBeVisible();
  });

  // The open list hangs past the card; it must not widen the page anywhere.
  for (const width of OVERFLOW_WIDTHS) {
    test(`an open list holds the layout and passes axe at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await open(page);
      await focusCity(page);
      const input = page.getByRole('combobox', { name: 'Населённый пункт' });
      await input.pressSequentially('кир');
      await expect(cityOptions(page).first()).toBeVisible();

      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
      const list = (await page.locator('#signup-city-list').boundingBox())!;
      const field = (await input.boundingBox())!;
      expect(Math.abs(list.x - field.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(list.width - field.width)).toBeLessThanOrEqual(1);
      expect(list.y).toBeGreaterThanOrEqual(field.y + field.height);
      // Every option is a comfortable touch target (design: 44px).
      const heights = await cityOptions(page).evaluateAll((els) =>
        els.slice(0, 5).map((el) => el.getBoundingClientRect().height),
      );
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
      expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
    });
  }
});

test.describe('registration page design', () => {
  test('prints the registration window and the venue from config', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Регистрация участников' })).toBeVisible();
    await expect(page.locator('.ob-reg__intro .ob-sh__overline')).toHaveText('VIII конгресс · 2027');

    const dates = page.locator('.ob-reg__dates');
    await expect(dates.locator('dt')).toHaveText([
      'Открытие регистрации',
      'Закрытие регистрации',
      'Приём докладов и тезисов',
    ]);
    await expect(dates.locator('dd')).toHaveText([
      '1 октября 2026 года, 00:00 (МСК)',
      '22 апреля 2027 года, 00:00 (МСК)',
      'с 1 октября по 1 декабря 2026 года',
    ]);

    const venue = page.locator('.ob-reg__venue');
    await expect(venue.locator('.ob-reg__vname')).toHaveText('ГК «Милан»');
    await expect(venue.locator('.ob-reg__vaddr')).toHaveText('Москва, ул.\u00a0Шипиловская, 28А');
    await expect(venue.locator('.ob-reg__vnote')).toHaveText('м.\u00a0«Домодедовская»\u00a0— 11\u00a0минут пешком');
    const mapUrl = 'https://yandex.ru/maps/org/milan/1088776161/';
    await expect(
      page.getByRole('link', { name: 'ГК «Милан» на карте (открывается в новой вкладке)' }),
    ).toHaveAttribute('href', mapUrl);
    await expect(page.getByRole('link', { name: /Открыть в Яндекс Картах/ })).toHaveAttribute('href', mapUrl);
  });

  test('serves the static map from the site itself, with its dimensions declared', async ({ page }) => {
    await open(page);
    const map = page.locator('.ob-reg__map-img');
    await map.scrollIntoViewIfNeeded();
    await expect(map).toHaveAttribute('alt', '');
    await expect(map).toHaveAttribute('width', /^\d+$/);
    await expect(map).toHaveAttribute('height', /^\d+$/);
    const src = await map.evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
    expect(new URL(src).origin).toBe(new URL(page.url()).origin);
    expect(new URL(src).pathname).toMatch(/^\/_astro\/venue-map\./);
    await expect.poll(() => map.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // The map is 2:1 and the pin sits on its centre, where the venue is.
    const [box, pin] = await Promise.all([
      page.locator('.ob-reg__map').boundingBox(),
      page.locator('.ob-reg__pin').boundingBox(),
    ]);
    expect(Math.abs(box!.width / box!.height - 2)).toBeLessThan(0.02);
    expect(Math.abs(pin!.x + pin!.width / 2 - (box!.x + box!.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(pin!.y + pin!.height / 2 - (box!.y + box!.height / 2))).toBeLessThanOrEqual(1);
  });

  test('stacks intro → form → venue below lg', async ({ page }) => {
    await page.setViewportSize({ width: 768 - SCROLLBAR_GUTTER, height: 900 });
    await open(page);
    await waitForWebfonts(page);
    const [intro, form, venue] = await Promise.all(
      ['.ob-reg__intro', '.ob-reg__form', '.ob-reg__aside'].map((sel) => page.locator(sel).boundingBox()),
    );
    expect(form!.y).toBeGreaterThanOrEqual(intro!.y + intro!.height);
    expect(venue!.y).toBeGreaterThanOrEqual(form!.y + form!.height);
  });

  test('puts the form beside the intro and the venue under the intro from lg', async ({ page }) => {
    // Headless scrollbars overlay, so a 1024 viewport IS the lg layout here.
    await page.setViewportSize({ width: 1024, height: 900 });
    await open(page);
    await waitForWebfonts(page);
    const [intro, form, venue] = await Promise.all(
      ['.ob-reg__intro', '.ob-reg__form', '.ob-reg__aside'].map((sel) => page.locator(sel).boundingBox()),
    );
    expect(form!.x).toBeGreaterThanOrEqual(intro!.x + intro!.width);
    expect(Math.round(form!.y)).toBe(Math.round(intro!.y));
    expect(Math.round(venue!.x)).toBe(Math.round(intro!.x));
    expect(venue!.y).toBeGreaterThanOrEqual(intro!.y + intro!.height);
  });

  // Issue #90: the page carries the home hero's own `EdgePattern` (its identity
  // with the hero is pinned in identity.spec.ts). Here: the lg threshold, the
  // stacking under the panel, the intro column left bare, no page overflow.
  test('shows the hero edge pattern from lg, under the form panel and clear of the intro', async ({ page }) => {
    const shapes = page.locator('.ob-reg > .ob-edge-pattern');
    await page.setViewportSize({ width: 1023, height: 900 });
    await open(page);
    await expect(shapes).toHaveCount(2);
    for (const shape of await shapes.all()) await expect(shape).toBeHidden();

    for (const width of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      // measureOverflow also waits for Inter, so the text boxes below are final.
      expect(await measureOverflow(page), `overflow @${width}`).toBeLessThanOrEqual(0);
      const [intro, venue] = await Promise.all(
        ['.ob-reg__intro', '.ob-reg__venue'].map((sel) => page.locator(sel).boundingBox()),
      );
      for (const shape of await shapes.all()) {
        await expect(shape).toBeVisible();
        const box = (await shape.boundingBox())!;
        for (const [name, other] of [['intro', intro!], ['venue', venue!]] as const) {
          expect(box.x, `pattern vs ${name} @${width}`).toBeGreaterThanOrEqual(other.x + other.width);
        }
      }
      // Paint order, as on the hero: the shapes are positioned with no z-index
      // and come FIRST; the grid is a positioned sibling after them, so it and
      // the panel's opaque green paint on top. A pixel sample cannot prove this
      // (`pointer-events: none` hides the shapes from `elementFromPoint`).
      const order = await page.evaluate(() => {
        const band = document.querySelector('.ob-reg')!;
        const kids = [...band.children];
        const grid = band.querySelector(':scope > .ob-reg__grid')!;
        const panel = getComputedStyle(document.querySelector('.ob-signup')!);
        return {
          shapesFirst: kids.slice(0, 2).every((el) => el.classList.contains('ob-edge-pattern')),
          gridAfter: kids.indexOf(grid) > 1,
          gridPosition: getComputedStyle(grid).position,
          shapeZ: [...band.querySelectorAll(':scope > .ob-edge-pattern')].map((el) => getComputedStyle(el).zIndex),
          bandOverflowX: getComputedStyle(band).overflowX,
          panelBg: panel.backgroundColor,
        };
      });
      expect(order.shapesFirst && order.gridAfter).toBe(true);
      expect(order.gridPosition).toBe('relative');
      expect(order.shapeZ).toEqual(['auto', 'auto']);
      expect(order.bandOverflowX).toBe('hidden');
      expect(order.panelBg).toMatch(/^(rgb\(|oklch\((?!.*\/))/);
    }
  });

  for (const width of [...OVERFLOW_WIDTHS, 1440]) {
    test(`the page with its edge pattern does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await open(page);
      expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  // The band absorbs the footer's top margin so the clip cuts the lower shape
  // on the footer's hairline, never flat across white space. 1440×900 is
  // content taller than the window; 1440×2000 and 1920×1900 are windows taller
  // than the page, where `main` grows and the band must grow with it.
  for (const state of DATED_STATES) {
    for (const [width, height] of [
      [1440, 900],
      [1440, 2000],
      [1920, 1900],
    ] as const) {
      test(`ends the pattern band on the footer line (${state.name}, ${width}×${height})`, async ({
        page,
        baseURL,
      }) => {
        await mockSpecialties(page);
        await serveAsProduction(page, baseURL!, new Date(state.at));
        await page.setViewportSize({ width, height });
        await page.goto(`${PROD_LIKE}/registration`, { waitUntil: 'networkidle' });
        await expect(page.locator(`[data-signup-state="${state.name}"]`)).toBeVisible();
        // The band ends where its text ends: measure it in Inter, not the fallback.
        await waitForWebfonts(page);
        const edges = await page.evaluate(() => {
          const bottom = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().bottom + scrollY;
          const foot = document.querySelector('.ob-foot')!.getBoundingClientRect().top + scrollY;
          return { band: bottom('.ob-reg'), shape: bottom('.ob-reg > .ob-edge-pattern--b'), foot };
        });
        const where = `${state.name} @${width}×${height}`;
        // The clip edge IS the footer's top border…
        expect(Math.abs(edges.band - edges.foot), `${where}: band vs footer`).toBeLessThanOrEqual(0.5);
        // …and the lower shape reaches past it, so what the clip cuts is the
        // shape, on that border — not a straight line above a white gap.
        expect(edges.shape, `${where}: lower shape vs footer`).toBeGreaterThanOrEqual(edges.foot);
      });
    }
  }

  // The fix is scoped to /registration: every other page keeps the footer's
  // own top margin.
  test('leaves the footer margin of other pages alone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 2000 });
    for (const path of ['/', '/archive/2026', '/partners', '/privacy']) {
      await page.goto(path);
      const margin = await page.locator('.ob-foot').evaluate((el) => getComputedStyle(el).marginTop);
      expect(margin, path).toBe('72px');
    }
  });

  test('draws the consent tick on the checkbox itself', async ({ page }) => {
    await open(page);
    const box = page.getByLabel(/согласен/);
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    await box.check();
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('data:image/svg+xml');
  });

  // The status cards replace the form, so the ladders above never render them.
  const STATES = [
    { name: 'not-yet-open', status: 422, json: { code: 'not-yet-open' }, heading: /Регистрация откроется/ },
    { name: 'closed', status: 422, json: { code: 'closed' }, heading: /Регистрация на конгресс закрыта/ },
    { name: 'success', status: 200, json: { status: 'accepted' }, heading: /Заявка принята/ },
  ] as const;
  for (const state of STATES) {
    for (const width of OVERFLOW_WIDTHS) {
      test(`the ${state.name} card holds at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
        await mockSignUp(page, state.status, state.json);
        await open(page);
        await fillValid(page);
        await submit(page);
        await expect(page.getByRole('heading', { level: 2, name: state.heading })).toBeVisible();

        expect(await measureOverflow(page)).toBeLessThanOrEqual(0);
        await expectNoHeadingSpill(page, `/registration ${state.name} @${width}`);
        await expectNoColumnOverlap(page, `/registration ${state.name} @${width}`);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''));
        expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
      });
    }
  }

  test('shows the form-level alert with its icon above the button', async ({ page }) => {
    await mockSignUp(page, 503);
    await open(page);
    await fillValid(page);
    await submit(page);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Регистрация временно недоступна');
    const icon = await alert.evaluate((el) => getComputedStyle(el, '::before').maskImage);
    expect(icon).toContain('data:image/svg+xml');
    const [alertBox, button] = await Promise.all([
      alert.boundingBox(),
      page.getByRole('button', { name: 'Зарегистрироваться' }).boundingBox(),
    ]);
    expect(button!.y).toBeGreaterThanOrEqual(alertBox!.y + alertBox!.height);
  });
});

// ── Audit of PR #87 ─────────────────────────────────────────────────────────
test.describe('registration page after the PR #87 audit', () => {
  test('draws a visible focus ring over the map, not under its image', async ({ page }) => {
    await open(page);
    const map = page.locator('.ob-reg__map-link');
    await map.scrollIntoViewIfNeeded();
    // Keyboard modality first, so the programmatic focus counts as :focus-visible.
    await page.keyboard.press('Shift');
    await map.focus();
    expect(await map.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    const overlay = await map.evaluate((el) => {
      const cs = getComputedStyle(el, '::after');
      return { shadow: cs.boxShadow, position: cs.position, events: cs.pointerEvents };
    });
    expect(overlay.position).toBe('absolute');
    expect(overlay.events).toBe('none');
    expect(overlay.shadow).toContain('inset');
    // Painted above the image: 3px inside the link's bottom edge (past the
    // 2px halo) the pixel is the ring (--focus-ring), not the map.
    const box = (await map.boundingBox())!;
    const shot = await page.screenshot({
      clip: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height) - 3, width: 1, height: 1 },
    });
    const ring = await page.evaluate(async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, shot.toString('base64'));
    const expected = await map.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = getComputedStyle(el).getPropertyValue('--focus-ring');
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color.match(/\d+/g)!.slice(0, 3).map(Number);
      probe.remove();
      return rgb;
    });
    ring.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(8));
  });

  // PR #87 review [BLOCKER]: the pre-paint snippet shows the form before the
  // module attaches its submit handler. Without the belts a native submit went
  // out as GET /registration?surname=…&email=… — personal data in URLs and logs.
  test('a form whose module never ran cannot submit, natively or otherwise', async ({ page }) => {
    await blockSignupModule(page);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await page.goto('/registration');
    await expect(page.locator('[data-signup-form]')).toBeVisible();
    await expect(page.locator('[data-signup-form]')).toHaveAttribute('method', 'post');
    const button = page.getByRole('button', { name: 'Зарегистрироваться' });
    await expect(button).toBeDisabled();

    await page.getByLabel('Фамилия').fill('Иванов');
    await page.getByLabel('E-mail').fill('ivanov@example.com');
    await page.getByLabel('E-mail').press('Enter');
    await button.click({ force: true });
    await page.waitForTimeout(500);

    expect(navigations, 'no navigation after the first load').toHaveLength(1);
    expect(page.url()).not.toContain('?');
    expect(page.url()).not.toContain('email=');
  });

  test('the submit button works once the module has attached its handler', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'Зарегистрироваться' })).toBeEnabled();
  });

  // The pre-paint snippet restates `registrationState` (unit-tested); this pins
  // the restatement to the same answers at the boundaries, with the module
  // blocked so that only the snippet decides which card is visible.
  const OPENS = Date.parse(REGISTRATION_WINDOW.opensAt);
  const CLOSES = Date.parse(REGISTRATION_WINDOW.closesAt!);
  const BOUNDARIES = [
    { label: '1 ms before opening', at: OPENS - 1 },
    { label: 'the opening instant', at: OPENS },
    { label: '1 ms before closing', at: CLOSES - 1 },
    { label: 'the closing instant', at: CLOSES },
  ];
  for (const { label, at } of BOUNDARIES) {
    test(`the pre-paint card agrees with registrationState at ${label}`, async ({ page, baseURL }) => {
      await blockSignupModule(page);
      await serveAsProduction(page, baseURL!, new Date(at));
      await page.goto(`${PROD_LIKE}/registration`);
      const expected = registrationState(REGISTRATION_WINDOW, new Date(at), 'orthobio.test');
      await expect(page.locator('[data-signup-state]:visible')).toHaveCount(1);
      await expect(page.locator('[data-signup-state]:visible')).toHaveAttribute('data-signup-state', expected);
    });
  }

  test('the pre-paint card is the form on a force-open host, whatever the date', async ({ page }) => {
    await blockSignupModule(page);
    await page.clock.setFixedTime(new Date(OPENS - 86_400_000));
    await page.goto('/registration');
    expect(registrationState(REGISTRATION_WINDOW, new Date(OPENS - 86_400_000), 'localhost')).toBe('open');
    await expect(page.locator('[data-signup-state]:visible')).toHaveAttribute('data-signup-state', 'open');
  });

  test('credits OpenStreetMap on the map, as real text that opens the licence', async ({ page }) => {
    await open(page);
    const credit = page.getByRole('link', { name: /© участники OpenStreetMap/ });
    await expect(credit).toBeVisible();
    await expect(credit).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(credit).toHaveAttribute('target', '_blank');
    await expect(credit).toHaveAccessibleName(/открывается в новой вкладке/);
    // Inside the map frame, in its corner — not somewhere else on the page.
    await waitForWebfonts(page);
    const [map, box] = await Promise.all([page.locator('.ob-reg__map').boundingBox(), credit.boundingBox()]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(map!.x + map!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(map!.y + map!.height + 1);
    expect(box!.y).toBeGreaterThan(map!.y + map!.height / 2);
  });

  // The design's chevron is the only arrow in the field (no native datalist
  // indicator any more), and it toggles the field's own list.
  for (const label of ['Специальность', 'Населённый пункт']) {
    test(`a click on the «${label}» chevron focuses the field and toggles its list`, async ({ page }) => {
      await open(page);
      if (label === 'Населённый пункт') await focusCity(page);
      const input = page.getByLabel(label, { exact: true });
      const chevron = input.locator('xpath=following-sibling::*[@data-combo-open]');
      const list = page.locator(`#${await input.getAttribute('aria-controls')}`);
      await page.getByLabel('Место работы').focus();

      await chevron.click();
      await expect(input).toBeFocused();
      await expect(list).toBeVisible();
      await expect(input).toHaveAttribute('aria-expanded', 'true');

      await chevron.click();
      await expect(list).toBeHidden();
      await expect(input).toHaveAttribute('aria-expanded', 'false');
      await expect(input).toBeFocused();
    });
  }

  test('no native picker indicator is painted beside the chevron', async ({ page }) => {
    await open(page);
    for (const label of ['Специальность', 'Населённый пункт']) {
      const input = page.getByLabel(label, { exact: true });
      // No datalist behind the field, so Chrome has no indicator to draw.
      await expect(input).not.toHaveAttribute('list', /.*/);
      expect(await input.evaluate((el: HTMLInputElement) => el.list)).toBeNull();
    }
    await expect(page.locator('#signup-form datalist, [data-signup] datalist')).toHaveCount(0);
  });

  // Every state card used to be revealed after the first paint, so the form
  // column opened from zero height and shoved the venue card down (CLS up to
  // 0.28). A non-force-open host is needed to see the dated states
  // (`serveAsProduction`).
  for (const state of DATED_STATES) {
    // 1280 too: from lg the form sits beside the intro, so a late card cannot
    // push the venue down there — but the ladder is the ladder.
    for (const width of OVERFLOW_WIDTHS) {
      test(`the ${state.name} state lays out without a shift at ${width}px`, async ({ page, baseURL }) => {
        const at = new Date(state.at);
        await mockSpecialties(page);
        await serveAsProduction(page, baseURL!, at);
        await page.addInitScript(() => {
          (window as unknown as { __cls: number }).__cls = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
              if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        });
        await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
        await page.goto(`${PROD_LIKE}/registration`, { waitUntil: 'networkidle' });
        await expect(page.locator(`[data-signup-state="${state.name}"]`)).toBeVisible();
        // The server-clock re-judge has answered (networkidle); give the
        // observer a frame to report whatever it caused.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls, `CLS of the ${state.name} state at ${width}px`).toBeLessThan(0.1);
      });
    }
  }
});

test.describe('sign-up form on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a tap on «Зарегистрироваться» right after an unlisted place reaches validation', async ({ page }) => {
    const requests = await mockSignUp(page, 200);
    await open(page);
    await fillValid(page);
    await focusCity(page);
    await page.getByLabel('Населённый пункт').fill('Минск');
    await page.getByRole('button', { name: 'Зарегистрироваться' }).tap();
    await expect(page.locator('#signup-region-error')).toHaveText('Заполните это поле.');
    await expect(page.getByLabel('Регион')).toBeFocused();

    await page.getByLabel('Регион').fill('Беларусь');
    await page.getByRole('button', { name: 'Зарегистрироваться' }).tap();
    await expect(page.locator('[data-signup-success]')).toBeVisible();
    expect(requests).toHaveLength(1);
  });
});

test.describe('sign-up form without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('asks for JavaScript in a date-neutral line and shows no form', async ({ page }) => {
    await page.goto('/registration');
    await expect(page.getByRole('heading', { name: 'Регистрация на конгресс', exact: true })).toBeVisible();
    // Playwright's text engine skips <noscript>, so the line is read by selector.
    const line = page.locator('noscript .ob-signup__stext');
    await expect(line).toBeVisible();
    await expect(line).toHaveText('Для регистрации включите JavaScript в браузере.');
    await expect(page.getByRole('heading', { name: /Регистрация откроется/ })).toBeHidden();
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

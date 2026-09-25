/**
 * Site configuration — the SINGLE artifact holding every cross-cutting value
 * and every still-undecided owner input (Issue #4 AC: «все TODO(Антон)-значения
 * вынесены в один конфиг, не разбросаны по шаблонам»).
 *
 * Rules:
 * • Nothing here is copy that belongs to a page — page copy lives in the
 *   `pages` content collection (RU typography applied at the schema boundary).
 * • An undecided value is `null`, never a plausible-looking placeholder: the
 *   templates render an honest state for `null` (see PENDING_* usages), so a
 *   wrong link can never ship silently.
 */

import { formatMoscowDateRange, instantFromEnv } from '@/lib/dates';

/** Public site metadata. */
export const SITE = {
  /** Wordmark in the header. */
  name: 'ОРТОБИОЛОГИЯ',
  /** Sub-line under the wordmark. */
  tagline: 'КОНГРЕСС · 2027',
  /** Used to compose <title> and og:site_name. */
  title: 'ОРТОБИОЛОГИЯ 2027 — VIII Конгресс',
  /** Ordinal of the upcoming congress (VIII in 2027). */
  upcomingNumber: 8,
  upcomingYear: 2027,
} as const;

/**
 * Dates of the upcoming congress, confirmed by the owner on 2026-07-31.
 *
 * The display form is authored with Russian typography because config strings
 * do not pass through the Content Layer's `prose()` transform. ISO values are
 * kept alongside it for machine-readable consumers and regression checks.
 */
export const UPCOMING_CONGRESS_DATES = {
  display: '23–24 апреля 2027',
  startDate: '2027-04-23',
  endDate: '2027-04-24',
} as const;

/**
 * Venue of the upcoming congress, confirmed by the owner on 2026-08-05
 * (Issue #71). Until then the site published an honest «площадка будет
 * объявлена» placeholder — `null` was the state, not a guess.
 *
 * Like the dates above, this string bypasses the Content Layer's `prose()`
 * transform, so RU typography is authored by hand: ` ` after the
 * abbreviated «ул.»/«д.» keeps «ул. Шипиловская» and «д. 28А» from breaking
 * across lines on a 360px viewport. Typograf, which typesets the same address
 * where it appears in YAML, binds more joins than these two — what is written
 * here is the load-bearing subset, not a reproduction of its output.
 */
export const UPCOMING_CONGRESS_VENUE = {
  /** Full address as printed in the hero and the FAQ answer. */
  display: 'ГК «Милан», Москва, ул. Шипиловская, д. 28А',
  /** Venue name alone, for sentences that already name the city. */
  name: 'ГК «Милан»',
  /**
   * The venue card on /registration (Issue #82, approved design): the venue
   * name, the address on its own line and how to get there. Name and walking
   * time confirmed by the owner in Issue #88 («ГК «Милан»», 11 minutes — the
   * design mock's «Отель» and 15 were wrong). The address keeps the design's
   * short form («28А», no «д.»). Typography by hand, as above: no-break spaces
   * after «ул.»/«м.», before the dash and inside «11 минут».
   */
  card: {
    name: 'ГК «Милан»',
    address: 'Москва, ул. Шипиловская, 28А',
    note: 'м. «Домодедовская» — 11 минут пешком',
  },
  /** The organisation's page on Yandex Maps — the target of the venue card. */
  mapUrl: 'https://yandex.ru/maps/org/milan/1088776161/',
} as const;

/**
 * Public base URL of our Timeweb S3 bucket (`orthobio-media`, provisioned in
 * Issue #2 — see infra/terraform/ and docs/assets-manifest.yaml
 * `meta.s3_public_base_url`).
 *
 * Content YAML stores media as root-relative `/media/<s3_key>` paths so the
 * files stay portable (staging tree → S3 → a future CDN/CMS is a change of THIS
 * constant only). `mediaUrl()` below is the single mapping seam — components
 * never concatenate a host.
 */
export const MEDIA_BASE_URL = 'https://s3.twcstorage.ru/orthobio-media/';

/** Prefix used by content files for media that lives in the bucket. */
const MEDIA_PREFIX = '/media/';

/**
 * Resolve a content media path to a fetchable URL.
 *
 * `/media/<key>` → `<MEDIA_BASE_URL><key>`. Anything else (a `public/` path, an
 * https URL already on our storage) is returned untouched — the schema's
 * allowlist (`src/content/schemas.ts`) has already proven it is ours.
 */
export const mediaUrl = (path: string): string =>
  path.startsWith(MEDIA_PREFIX) ? MEDIA_BASE_URL + path.slice(MEDIA_PREFIX.length) : path;

/**
 * Opening of registration, confirmed by the owner on 2026-08-05 (Issue #71).
 *
 * An EXACT day, no longer a month: it supersedes the planned «ноябрь 2026»,
 * which was carried in two grammatical cases because «откроется В ноябре» and
 * «к открытию — ноябрь» need different forms. A day takes no preposition at
 * all («откроется 1 октября 2026 года»), so one display form serves every
 * sentence on the site and the case pair is gone.
 *
 * The date is repeated across a dozen strings — config, templates and page
 * copy — so it must move in one place. Templates read this constant directly;
 * the page YAML cannot interpolate TypeScript, so
 * `tests/unit/content-dates.test.ts` fails the build if any content file
 * dates registration differently (content audit М2).
 */
export const REGISTRATION_OPENS = {
  /** «Регистрация откроется 1 октября 2026 года», «…к открытию — 1 октября 2026». */
  display: '1 октября 2026',
  /** Machine-readable twin, kept for regression checks. */
  date: '2026-10-01',
} as const;

/**
 * Submission window for talks, abstracts and posters — owner-confirmed
 * 2026-08-05 (Issue #71); a setting since Issue #98 («вынести эту дату в
 * настройки, чтобы можно было легко менять»). It opens together with
 * registration and closes two months later.
 *
 * ONE place to change it: the two instants below, Moscow time. `display` is
 * derived, and page copy never spells the range out — it writes the token
 * `{{submissionWindow}}` (see `CONTENT_TOKENS`), which `getPage()` fills;
 * /registration prints `display` directly. So every
 * page follows an edit here. The copy states it in a sentence WITHOUT the word
 * «регистрация» (see `tests/unit/content-dates.test.ts`).
 *
 * `closesAt` convention, shared by EVERY `closesAt` in this file, its env
 * override and the platform API: the FIRST moment no longer accepted
 * (exclusive). «по 1 декабря» is therefore stored as `2026-12-02T00:00:00+03:00`;
 * the formatter prints the last Moscow calendar day before that instant.
 *
 * Build-time overrides, blank = default: `PUBLIC_CONGRESS_SUBMISSION_WINDOW_OPENS_AT`
 * / `PUBLIC_CONGRESS_SUBMISSION_WINDOW_CLOSES_AT` (fed in CI from the repository
 * Variables `CONGRESS_SUBMISSION_WINDOW_OPENS_AT` / `…_CLOSES_AT`). The site is
 * static, so an override takes effect with the next deploy.
 */
const submissionOpensAt = instantFromEnv(
  'PUBLIC_CONGRESS_SUBMISSION_WINDOW_OPENS_AT',
  import.meta.env.PUBLIC_CONGRESS_SUBMISSION_WINDOW_OPENS_AT,
  '2026-10-01T00:00:00+03:00',
);
const submissionClosesAt = instantFromEnv(
  'PUBLIC_CONGRESS_SUBMISSION_WINDOW_CLOSES_AT',
  import.meta.env.PUBLIC_CONGRESS_SUBMISSION_WINDOW_CLOSES_AT,
  '2026-12-02T00:00:00+03:00',
);

export const SUBMISSION_WINDOW = {
  opensAt: submissionOpensAt,
  closesAt: submissionClosesAt,
  /**
   * «с 1 октября по 1 декабря 2026 года», typeset by hand (nbsp) like every
   * config string. A getter, like `CONTENT_TOKENS` below: SignupForm's browser
   * script imports this module for `REGISTRATION_WINDOW`, and an eager value
   * here would run Intl formatting on load in the only PII form's client script.
   */
  get display(): string {
    return formatMoscowDateRange(submissionOpensAt, submissionClosesAt);
  },
} as const;

/**
 * Values page copy (`src/content/pages/*.yaml`) may reference as `{{name}}`.
 * Filled in `getPage()` after the Content Layer cache, so components never see
 * a token and a future CMS loader feeding the same plain text needs no
 * component change. An unknown token fails the build (`fillContentTokens`).
 * Values arrive already typeset: the page's Typograf pass ran before the fill.
 */
export const CONTENT_TOKENS: Readonly<Record<string, string>> = {
  get submissionWindow(): string {
    return SUBMISSION_WINDOW.display;
  },
};

/**
 * Registration window as the site DISPLAYS it (Issue #78; platform 044
 * EARS-28). Enforcement is the platform API's — its env pair
 * `CONGRESS_SIGNUP_WINDOW_OPENS_AT` / `…_CLOSES_AT` refuses a submission outside
 * the window. These instants and the API's must be the same instants; keeping
 * them equal is a launch check on ds-platform#2292, since they live in two
 * repositories. The page evaluates the window in the browser
 * (`src/lib/registration.ts` explains why not at build time).
 *
 * `opensAt` is the same day as `REGISTRATION_OPENS` above, as an instant with an
 * explicit Moscow offset. `closesAt` is the owner's decision of 2026-09-25
 * (Issue #98): registration closes one day before the congress, at midnight
 * Moscow on 22 April 2027. The API env on ds-platform#2292 must carry the same
 * instant (`CONGRESS_SIGNUP_WINDOW_CLOSES_AT=2027-04-22T00:00:00.000+03:00`) — a
 * change here must be mirrored there (and vice versa), or the page and the API
 * disagree about whether registration is closed.
 *
 * `closesAt` takes a build-time override, `PUBLIC_CONGRESS_SIGNUP_WINDOW_CLOSES_AT`
 * (fed in CI from the repository Variable `CONGRESS_SIGNUP_WINDOW_CLOSES_AT`, the
 * API's own variable name); blank = the default below. `PUBLIC_` because the
 * page script imports this constant into the browser bundle, where Astro
 * inlines only public variables — a private one would leave the server-rendered
 * label and the in-browser judgement on two different instants. `opensAt` has
 * no override on purpose: the opening day is also written into the copy of six
 * pages (`REGISTRATION_OPENS`), which an env value could not move.
 *
 * Keep the default an inline ISO literal: the e2e suite reads it from this
 * source (it cannot import a module that touches `import.meta.env`).
 *
 * Typed `string`, not `string | null`: nothing on the site depends on the
 * «never closes» reading any more. `RegistrationWindow` in
 * `src/lib/registration.ts` still accepts `null`, so the pure rule stays general.
 */
export const REGISTRATION_WINDOW = {
  opensAt: '2026-10-01T00:00:00+03:00',
  closesAt: instantFromEnv(
    'PUBLIC_CONGRESS_SIGNUP_WINDOW_CLOSES_AT',
    import.meta.env.PUBLIC_CONGRESS_SIGNUP_WINDOW_CLOSES_AT,
    '2027-04-22T00:00:00+03:00',
  ),
} as const satisfies { opensAt: string; closesAt: string };

/**
 * Yandex SmartCaptcha client keys, read at BUILD time from the env vars
 * `PUBLIC_SMARTCAPTCHA_SITEKEY` (production, captcha ds-platform-prod) and
 * `PUBLIC_SMARTCAPTCHA_SITEKEY_PREVIEW` (preview, captcha ds-platform-stage).
 * Both are public by design — printed into the page; the server keys live only
 * in the platform API's env. Preview and production ship the same build, so
 * both keys are emitted and the browser picks one by hostname
 * (`pickSitekey` in lib/captcha.ts, Issue #81). An empty key for the current
 * host means no widget, no script and no `captchaToken` in the request — the
 * local and e2e builds run that way, and a platform that does enforce the
 * captcha then refuses with 403, which the form reports as a generic error.
 */
export const SMARTCAPTCHA_SITEKEY: string = String(
  import.meta.env.PUBLIC_SMARTCAPTCHA_SITEKEY ?? '',
).trim();
export const SMARTCAPTCHA_SITEKEY_PREVIEW: string = String(
  import.meta.env.PUBLIC_SMARTCAPTCHA_SITEKEY_PREVIEW ?? '',
).trim();

/**
 * Home-page primary CTA (Issue #78): the congress sign-up form. An internal
 * route, so the button stays in the current tab; the page itself decides
 * whether it shows the form or the «откроется …» / «закрыта» state.
 */
export const REGISTRATION_URL = '/registration';
export const REGISTRATION_CTA_LABEL = 'Регистрация на конгресс';

/**
 * «Узнать первым» on the /registration «откроется …» card (Issue #88, owner
 * decision): the Doctor.School Telegram channel. The ONLY «узнать первым»
 * link on the site — the e2e suite holds every such link to this URL.
 */
export const NOTIFY_CHANNEL_URL = 'https://t.me/DoctorSchool';
export const NOTIFY_CTA_LABEL = 'Узнать первым';

/**
 * Public congress contacts approved by the owner in Issue #54 (2026-07-30).
 * These belong to Doctor.School, not to the outgoing site's technical operator.
 */
export const CONTACT_EMAIL: string | null = 'manager@doctor.school';
export const CONTACT_PHONE: string | null = '8 (495) 410-04-90';

/**
 * Owner decision (Issue #54, 2026-07-30): leave the 20 YouTube archive links
 * unchanged. They remain an explicit exception to the RF-accessibility rule;
 * three 2025 videos stay on Rutube.
 *
 * Что уже сделано (Issue #19): три ролика Rutube играют прямо на странице года
 * (click-to-load плеер), двадцать роликов YouTube остаются внешней ссылкой с
 * явной пометкой «откроется на YouTube» — встраивать фрейм, который у половины
 * аудитории не прогрузится, мы не стали.
 *
 * The exception is intentionally contained: YouTube is never loaded by the
 * page, only opened after an explicit outbound click. Replacing the links with
 * Rutube later remains a content-only change in the year YAML files.
 */

/**
 * Primary navigation. Covers the ТЗ §4 page map; the design mockup's 6-item nav
 * is extended with «Участникам» and «НМО» so no §4 route is reachable only from
 * the footer. Below lg the same data renders in the design's disclosure menu.
 */
export const NAV = [
  { href: '/', label: 'Главная' },
  { href: '/program', label: 'Программа' },
  { href: '/participants', label: 'Участникам' },
  { href: '/orgs', label: 'Оргкомитет' },
  { href: '/nmo', label: 'НМО' },
  { href: '/partners', label: 'Партнёрам' },
  { href: '/archive/', label: 'Архив' },
  { href: '/faq', label: 'FAQ' },
] as const;

/**
 * Footer sitemap — the full §4 map, including routes absent from the nav: the
 * contacts page, and the two sign-up routes of Issue #78 (the form is reached
 * from the home-page CTA, the policy from the form's consent checkbox; the
 * footer is where both are findable from every page without crowding the nav).
 */
export const FOOTER_LINKS = [
  ...NAV,
  { href: '/contacts', label: 'Контакты' },
  { href: REGISTRATION_URL, label: 'Регистрация' },
  { href: '/privacy', label: 'Политика конфиденциальности' },
] as const;

/**
 * Chrome strings (header/footer). UI chrome, not editorial page copy: like the
 * nav labels above they are part of the shell, so they live here rather than in
 * the `page` collection — page copy goes through the schema's `prose()`
 * transform, and these few strings are authored already typeset.
 *
 * `about` names МОО «ОРТО» as the organizer of the CONGRESS — the society that
 * owns the event across all its editions, not a 2027 partner roster.
 *
 * PROVENANCE, because the two sources disagree and the disagreement is only
 * apparent. `docs/recon/orthobio-ru-main.md:20` lists FIVE organizing bodies
 * for the 2026 edition (ОРТО, АТОР, МАПО, НМИЦ ТО им. Приорова, кафедра
 * травматологии и ортопедии ФНКЦ ФМБА) — that is the co-organizer roster of one
 * congress, and it lives on /orgs, where it is rendered per year. This line is
 * about the society that holds the event itself, and it is not our inference:
 * the owner edited the footer copy directly in the design system on 2026-07-28
 * (Claude.design, `ui_kits/orthobio-site/Chrome.jsx`), which is the canonical
 * design input for this site. So no TODO(Антон) marker — the question was put to
 * the owner and answered. If it is ever reopened, it is reopened in the design
 * system first, not here (PR #17 review raised it; resolved as above).
 *
 * The copyright line no longer says «при поддержке
 * Doctor.School»: on /partners that sat three screens under «партнёрский состав
 * 2027 не объявлен» and read as a support claim for the upcoming congress
 * (content audit С4). Doctor.School stays in the footer as the site's author —
 * the mark alone, opposite the copyright.
 */
export const FOOTER = {
  /**
   * Slogan of the upcoming congress (owner request, Issue #74).
   *
   * Config strings bypass the Content Layer's `prose()` transform, so the RU
   * typography is hand-authored: the space before the em dash is a NON-BREAKING
   * one. It is invisible in this file but load-bearing — it is exactly what
   * `typographize()` emits for the same slogan on the home page
   * (`content/pages/home.yaml`, `overline`), which is stored as plain text.
   * Two copies of one string cannot be kept in sync by eye, so
   * `tests/unit/congress-slogan.test.ts` pins them to each other.
   */
  slogan: 'Объединяем знания — даём движение вперёд!',
  about:
    'Конгресс по регенеративной травматологии и ортопедии. Организатор — МОО «Общество регенеративной травматологии и ортопедии» (ОРТО). Материалы конгрессов 2021–2026 — в архиве сайта.',
  /** Shown while CONTACT_EMAIL is null. */
  contactsPending: `Контакты оргкомитета будут опубликованы к открытию регистрации — ${REGISTRATION_OPENS.display}.`,
  copyright: `© 2021–${SITE.upcomingYear} · Конгресс ОРТОБИОЛОГИЯ`,
} as const;

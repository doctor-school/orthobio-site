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
 * Planned opening of registration (ТЗ §4: «трафик к открытию регистрации»).
 *
 * The date is repeated across a dozen strings — config, templates and page
 * copy — and it is a PLAN, not an announced date: when it moves, it must move
 * in one place. Templates read these constants directly; the page YAML cannot
 * interpolate TypeScript, so `tests/unit/registration-date.test.ts` fails the
 * build if any content file names a different month (content audit М2).
 */
export const REGISTRATION_OPENS = {
  /** Nominative — «…к открытию регистрации — ноябрь 2026». */
  nominative: 'ноябрь 2026',
  /** Prepositional — «регистрация откроется в ноябре 2026 года». */
  prepositional: 'ноябре 2026',
} as const;

/**
 * ⚠️ TODO(Антон): куда ведёт CTA «узнать первым» — t.me/DoctorSchool или
 * отдельный канал конгресса (Issue #4, ТЗ §6 open question 5)?
 *
 * The design v2 mockup draws the CTA as a live button to `t.me/DoctorSchool`,
 * but which channel receives the traffic is an account decision, not a design
 * one — so the value stays `null` until the owner confirms it. While null the
 * home page renders the CTA block as a static statement («Регистрация
 * откроется в ноябре 2026») plus a note that the subscription channel will be
 * announced — an honest state, not a dead button. Setting a URL here turns the
 * same block into the primary CTA button and needs no template change.
 */
export const SUBSCRIBE_URL: string | null = null;

/** Label of the «узнать первым» CTA (constant regardless of the channel). */
export const SUBSCRIBE_LABEL = `Регистрация откроется в ${REGISTRATION_OPENS.prepositional} — узнать первым`;

/**
 * ⚠️ TODO(Антон): контактный адрес оргкомитета конгресса-2027.
 * ЯВНО НЕ welcome@congress-ph.ru — это адрес технического оператора ООО «Ай Си
 * Эс» (текущий сайт), а не наш (Issue #4, ТЗ §4 /contacts).
 *
 * `null` until the owner decides; /contacts and /partners then render «контакты
 * будут опубликованы», never a made-up address.
 */
export const CONTACT_EMAIL: string | null = null;

/** ⚠️ TODO(Антон): телефон оргкомитета, если он вообще будет публичным. */
export const CONTACT_PHONE: string | null = null;

/**
 * ⚠️ TODO(Антон): 20 из 23 архивных видео (2021-2024) лежат на YouTube, 3
 * (2025) — на Rutube. Для врача из РФ YouTube с 2024 года — лотерея, а
 * RF-доступность у нас жёсткое ограничение.
 *
 * Что уже сделано (Issue #19): три ролика Rutube играют прямо на странице года
 * (click-to-load плеер), двадцать роликов YouTube остаются внешней ссылкой с
 * явной пометкой «откроется на YouTube» — встраивать фрейм, который у половины
 * аудитории не прогрузится, мы не стали.
 *
 * Что остаётся за владельцем: перезаливать ли 20 роликов на Rutube (или в наш
 * S3). Да → все 23 играют на сайте одинаково и `ALLOWED_VIDEO_HOSTS` со
 * временем схлопнется до Rutube; нет → архив 2021-2024 навсегда уводит зрителя
 * на чужой хост. Кода это не касается: обе ветки уже реализованы, поменяются
 * только `url` в `src/content/congress/<year>.yaml`.
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

/** Footer sitemap — the full §4 map, including routes absent from the nav. */
export const FOOTER_LINKS = [...NAV, { href: '/contacts', label: 'Контакты' }] as const;

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
  slogan: 'Будущее начинается здесь',
  about:
    'Конгресс по регенеративной травматологии и ортопедии. Организатор — МОО «Общество регенеративной травматологии и ортопедии» (ОРТО). Материалы конгрессов 2021–2026 — в архиве сайта.',
  /** Shown while CONTACT_EMAIL is null. */
  contactsPending: `Контакты оргкомитета будут опубликованы к открытию регистрации — ${REGISTRATION_OPENS.nominative}.`,
  copyright: `© 2021–${SITE.upcomingYear} · Конгресс ОРТОБИОЛОГИЯ`,
} as const;

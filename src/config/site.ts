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
 * ⚠️ TODO(Антон): куда ведёт CTA «узнать первым» — t.me/DoctorSchool или
 * отдельный канал конгресса (Issue #4, ТЗ §6 open question 5)?
 *
 * `null` until decided. While null the home page renders the CTA block as a
 * static statement («Регистрация откроется в ноябре 2026») plus a note that the
 * subscription channel will be announced — an honest state, not a dead button.
 * Setting a URL here turns the same block into the primary CTA button and needs
 * no template change.
 */
export const SUBSCRIBE_URL: string | null = null;

/** Label of the «узнать первым» CTA (constant regardless of the channel). */
export const SUBSCRIBE_LABEL = 'Регистрация откроется в ноябре 2026 — узнать первым';

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
 * Primary navigation. Covers the ТЗ §4 page map; the design mockup's 6-item nav
 * is extended with «Участникам» and «НМО» so no §4 route is reachable only from
 * the footer. The nav wraps (never scrolls) at 360px.
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
 * The organizer line deliberately does NOT name a 2027 organizing body: the
 * 2026 site lists five organizer entities and the 2027 composition is not
 * confirmed (ТЗ §4 «честные заглушки»).
 */
export const FOOTER = {
  about:
    'Научный конгресс по регенеративной травматологии и ортопедии. Материалы конгрессов 2021–2026 — в архиве сайта.',
  /** Shown while CONTACT_EMAIL is null. */
  contactsPending: 'Контакты оргкомитета будут опубликованы к открытию регистрации — ноябрь 2026.',
  copyright: `© 2021–${SITE.upcomingYear} · При поддержке Doctor.School`,
} as const;

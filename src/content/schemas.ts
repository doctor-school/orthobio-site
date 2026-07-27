/**
 * Zod schemas for the orthobio-site Content Layer.
 *
 * The `congress` collection models one «выпуск года конгресса» (congress year
 * edition) and is the SINGLE SOURCE OF TYPES for the site: pages and
 * components derive their props from `getCollection()` / `getEntry()`, never
 * from hand-written interfaces.
 *
 * ── Loader-swap invariant (AGENTS.md) ────────────────────────────────────────
 * This schema is the prototype of the future Doctor.School «конструктор
 * мероприятий» module (Событие → выпуск года → блоки: программа / спикеры /
 * партнёры / материалы / фото). Content starts as local YAML; when the
 * platform goes live only the loader in `content.config.ts` changes. Therefore
 * every prose field is PLAIN TEXT (never rich-text ASTs) and the shapes below
 * are what a future CMS loader must emit.
 *
 * ── Nullability contract (ТЗ §4 «честные заглушки») ──────────────────────────
 * Unknown facts are explicit `null` / empty lists — NEVER invented and never
 * copy-pasted from a neighbouring year. Every non-null value in a content file
 * must trace to `docs/recon/*.md`.
 *
 * `z` comes from `astro/zod` (the exact Zod bundle Astro ships), not the
 * deprecated `z` re-export from `astro:content`.
 */

import { z } from 'astro/zod';

import { typographize } from './typographize';

/**
 * Build-time RU typographer seam. Canonical content stays plain text; the site
 * normalizes typography (ёлочки, nbsp after short prepositions / numbers, em
 * dashes) at the SCHEMA boundary so it survives the local→CMS loader swap
 * untouched. Output is Unicode, not html entities (see `typographize.ts`), so
 * it is safe in both `.astro` text nodes and attributes.
 *
 * APPLY `prose()` to human-readable copy ONLY. NEVER to: person or
 * organization names (verbatim identity tokens — the typographer must not
 * reflow initials like «И.И.»), enums/tiers, URLs, file paths, ids.
 */
const prose = () => z.string().transform(typographize);

/** Nullable prose: `null` means «нет данных», never an invented value. */
const proseOrNull = () => prose().nullable().default(null);

/**
 * Media location: either an absolute URL on OUR infrastructure (Timeweb S3)
 * or a root-relative path into `public/` (e.g. `/files/2024/theses.pdf`).
 *
 * The refine enforces the ТЗ §4 principle «никаких внешних архивных ссылок» at
 * build time: links into the legacy clouds (Google Drive, Яндекс.Диск,
 * Creatium, Bitrix24, congress-ph CDNs) fail validation instead of silently
 * shipping a link that can die at any moment.
 */
const FORBIDDEN_MEDIA_HOSTS = [
  'drive.google.com',
  'docs.google.com',
  'disk.yandex',
  'creatium.site',
  'creatium.ru',
  'bitrix24',
  'congress-ph',
  'c-ph.ru',
] as const;

const mediaLocation = () =>
  z
    .string()
    .regex(/^(https:\/\/|\/)/, 'must be an https:// URL (our S3) or a root-relative /path')
    .refine(
      (v) => !FORBIDDEN_MEDIA_HOSTS.some((host) => v.includes(host)),
      'external cloud links are forbidden (ТЗ §4): media must live on our S3 or in public/',
    );

/** Person addressing the congress (президиум / обращения, ТЗ §3 «Обращения»). */
const greetingSchema = z.object({
  /** Full name, verbatim (not prose-routed — identity token). */
  name: z.string(),
  /** Regalia / position, e.g. «д.м.н., профессор, сопрезидент конгресса». */
  role: proseOrNull(),
  /** Portrait photo (our S3 / public path); null when none was published. */
  photo: mediaLocation().nullable().default(null),
  /** Greeting text, plain paragraphs; null when only the persona is known. */
  text: proseOrNull(),
});

/** One talk inside a session (2024: 100+ докладчиков; 2025: 100+ докладов). */
const talkSchema = z.object({
  title: prose(),
  /** Speaker names, verbatim. Empty when the source lists no speakers. */
  speakers: z.array(z.string()).default([]),
});

/** One program session (2024: 34 сессии; 2025: ~30 сессий). */
const sessionSchema = z.object({
  title: prose(),
  /** Free-text time slot, e.g. «09:00–10:30»; null when unknown. */
  time: proseOrNull(),
  /** Hall / room; null when unknown. */
  hall: proseOrNull(),
  /** Moderator names, verbatim. */
  moderators: z.array(z.string()).default([]),
  talks: z.array(talkSchema).default([]),
});

/**
 * Partner / organizer tiers, superset of everything seen in recon:
 * 2025 archive (организаторы 7 + соорганизаторы 12 + стратегический партнёр)
 * and 2026 site (2 стратегических, 5 генеральных, 6 партнёров, 9 партнёров
 * выставки, 9 инфопартнёров).
 */
export const PARTNER_TIERS = [
  'organizer',
  'co-organizer',
  'strategic',
  'general',
  'partner',
  'exhibition',
  'info',
] as const;
export type PartnerTier = (typeof PARTNER_TIERS)[number];

/** Russian display labels for partner tiers (presentation, kept out of content). */
export const PARTNER_TIER_LABELS: Record<PartnerTier, string> = {
  organizer: 'Организаторы',
  'co-organizer': 'Соорганизаторы',
  strategic: 'Стратегические партнёры',
  general: 'Генеральные партнёры',
  partner: 'Партнёры',
  exhibition: 'Партнёры выставки',
  info: 'Информационные партнёры',
};

const partnerSchema = z.object({
  /** Organization name, verbatim (brand — not prose-routed). */
  name: z.string(),
  tier: z.enum(PARTNER_TIERS),
  /** Logo on our S3 / public path; null when we have no asset yet. */
  logo: mediaLocation().nullable().default(null),
  /** Partner's own site. External here is fine — it is attribution, not media. */
  url: z.url().nullable().default(null),
});

/**
 * Congress year edition — one YAML file per year
 * (`src/content/congress/<year>.yaml`). Covers every block of the ТЗ §4
 * archive template (заголовок · президиум/обращения · программа · фотогалерея ·
 * тезисы · партнёры года) plus everything the §3 recon table surfaced
 * (оргкомитет с регалиями, видеоотчёт).
 */
export const congressSchema = z.object({
  /** Must equal the filename; the redundancy guards against copy-paste files. */
  year: z.number().int().min(2021).max(2100),
  /** Congress ordinal (VIII in 2027 ⇒ 8); null until verified from recon. */
  number: z.number().int().positive().nullable().default(null),
  /** Display title, e.g. «VII Конгресс с международным участием ОРТОБИОЛОГИЯ». */
  title: proseOrNull(),
  /** Human-readable dates, e.g. «24–25 апреля 2026»; null = «даты уточняются». */
  dates: proseOrNull(),
  /** ISO start/end for machine use (sorting, schema.org); null when unknown. */
  startDate: z.coerce.date().nullable().default(null),
  endDate: z.coerce.date().nullable().default(null),
  /** City + venue as plain text, e.g. «Москва, отель Холидей Инн Сокольники». */
  place: proseOrNull(),
  /** Президиум / обращения. Empty list = no greetings published that year. */
  greetings: z.array(greetingSchema).default([]),
  /** Оргкомитет с регалиями (2025: 9 персон; 2026: 12). */
  committee: z
    .array(
      z.object({
        name: z.string(),
        regalia: proseOrNull(),
      }),
    )
    .default([]),
  /**
   * Программа года: structured sessions AND/OR a local/S3 PDF. `null` = no
   * program survived for that year (2021–2023). A year may have both (2026:
   * prog.pdf; 2024/2025: structured sessions).
   */
  program: z
    .object({
      pdf: mediaLocation().nullable().default(null),
      sessions: z.array(sessionSchema).default([]),
    })
    .nullable()
    .default(null),
  /** Фотогалерея: self-hosted S3 URLs only (never legacy clouds). */
  photos: z
    .array(
      z.object({
        url: mediaLocation(),
        /** Alt text for a11y; null falls back to a generic year caption. */
        alt: proseOrNull(),
      }),
    )
    .default([]),
  /** Видеоотчёт slots (§3 template; almost always empty in the archive). */
  videos: z
    .array(
      z.object({
        url: mediaLocation(),
        title: proseOrNull(),
      }),
    )
    .default([]),
  /** Сборник тезисов — local/S3 PDF; null when none exists or not yet rescued. */
  theses: z
    .object({
      pdf: mediaLocation(),
      title: proseOrNull(),
    })
    .nullable()
    .default(null),
  /** Партнёры и организаторы года, tiered. Empty = none published. */
  partners: z.array(partnerSchema).default([]),
  /** Draft entries are fixtures / unverified years; excluded from prod builds later. */
  draft: z.boolean().default(false),
});

export type Congress = z.infer<typeof congressSchema>;

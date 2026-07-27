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
 * Media location: either an https URL on OUR infrastructure (Timeweb S3) or a
 * root-relative path into `public/` (e.g. `/files/2024/theses.pdf`).
 *
 * Enforces the ТЗ §4 principle «никаких внешних архивных ссылок» at build time
 * as an ALLOWLIST (PR #7 review): only hosts we own pass. A denylist provably
 * leaks — `lh3.googleusercontent.com` (Drive's direct-image host), Tilda,
 * protocol-relative `//cdn…` all slipped through the previous substring check.
 * Protocol-relative `//host/path` is explicitly rejected: browsers resolve it
 * as an EXTERNAL URL, not a root-relative path.
 */
// TODO(#2): replace the placeholder with the real Timeweb S3 bucket host once
// provisioned (asset-rescue task). `s3.example-fixture.ru` exists only for the
// 2099 draft fixture and must be removed together with it.
export const ALLOWED_MEDIA_HOSTS = ['s3.orthobio.ru', 's3.example-fixture.ru'] as const;

const mediaLocation = () =>
  z.string().refine(
    (v) => {
      if (v.startsWith('//')) return false; // protocol-relative = external
      if (v.startsWith('/')) return true; // root-relative into public/
      const u = URL.parse(v);
      return (
        u?.protocol === 'https:' && (ALLOWED_MEDIA_HOSTS as readonly string[]).includes(u.hostname)
      );
    },
    `media must be a root-relative /path or an https URL on our own storage (ТЗ §4): ${ALLOWED_MEDIA_HOSTS.join(', ')}`,
  );

/**
 * Video embed hosts, allowed for `videos[].url` ONLY (Issue #3). Congress
 * video reports live on YouTube/Rutube as embeds — they are not self-hostable
 * archive files, so the ТЗ §4 self-hosting rule does not apply to them the way
 * it does to photos/PDFs. The photo/PDF `mediaLocation()` guard stays strict;
 * this is a separate, deliberately narrow allowlist for player links.
 */
export const ALLOWED_VIDEO_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'rutube.ru',
] as const;

/** Video link: our own media location OR an https URL on an allowed video host. */
const videoLocation = () =>
  z.string().refine(
    (v) => {
      if (v.startsWith('//')) return false; // protocol-relative = external
      if (v.startsWith('/')) return true; // root-relative into public/
      const u = URL.parse(v);
      return (
        u?.protocol === 'https:' &&
        ([...ALLOWED_MEDIA_HOSTS, ...ALLOWED_VIDEO_HOSTS] as readonly string[]).includes(u.hostname)
      );
    },
    `video must be a root-relative /path, our own storage, or an allowed video host: ${ALLOWED_VIDEO_HOSTS.join(', ')}`,
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
  /**
   * Day of the session, ISO date (e.g. `2025-04-18`); null when the source
   * does not attribute a day. Machine-usable so a two-day multi-hall program
   * can be grouped «день 1 / день 2» without parsing free-text `time`.
   */
  date: z.coerce.date().nullable().default(null),
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
  /**
   * Partner's own site. External here is fine — it is attribution, not media.
   * Protocol constrained to http(s): the schema is a trust boundary (also
   * after the CMS loader swap) and bare `z.url()` accepts `javascript:`.
   */
  url: z.url({ protocol: /^https?$/ }).nullable().default(null),
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
  /**
   * Фотогалерея: self-hosted S3 URLs only (never legacy clouds).
   * `width`/`height` are REQUIRED intrinsic pixel dimensions: `astro:assets`
   * cannot infer them for remote images, and the no-CLS rule (AGENTS.md)
   * needs them in the data model. The Issue #2 upload script knows both.
   */
  photos: z
    .array(
      z.object({
        url: mediaLocation(),
        /** Alt text for a11y; null falls back to a generic year caption. */
        alt: proseOrNull(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .default([]),
  /**
   * Cover / preview image for the year card on the `/archive/` hub (§4:
   * «карточки 2021–2026»). Explicit rather than `photos[0]` — some years have
   * no gallery at all. Null → the hub falls back to a text-only card.
   */
  cover: z
    .object({
      url: mediaLocation(),
      alt: proseOrNull(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable()
    .default(null),
  /**
   * Постеры года (§4: «4 постера» move to /archive/2026). Either images
   * (width/height required for no-CLS) or PDFs (dimensions null).
   */
  posters: z
    .array(
      z.object({
        url: mediaLocation(),
        title: proseOrNull(),
        width: z.number().int().positive().nullable().default(null),
        height: z.number().int().positive().nullable().default(null),
      }),
    )
    .default([]),
  /** Видеоотчёт slots (§3 template; almost always empty in the archive). */
  videos: z
    .array(
      z.object({
        /** Embed link — `videoLocation()`, NOT `mediaLocation()`: see ALLOWED_VIDEO_HOSTS. */
        url: videoLocation(),
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

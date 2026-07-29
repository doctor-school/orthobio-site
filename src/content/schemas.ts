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
 * root-relative path.
 *
 * Enforces the ТЗ §4 principle «никаких внешних архивных ссылок» at build time
 * as an ALLOWLIST (PR #7 review): only hosts we own pass. A denylist provably
 * leaks — `lh3.googleusercontent.com` (Drive's direct-image host), Tilda,
 * protocol-relative `//cdn…` all slipped through the previous substring check.
 * Protocol-relative `//host/path` is explicitly rejected: browsers resolve it
 * as an EXTERNAL URL, not a root-relative path.
 *
 * ── Two meanings of a root-relative path (PR #14 review) ─────────────────────
 * `/media/<key>` is a RESERVED prefix: it is not a file in `public/` (there is
 * none) but a bucket key, rewritten to `MEDIA_BASE_URL + key` by `mediaUrl()`
 * in `src/config/site.ts` — the single seam where the host is applied. Any
 * other `/path` is served from the site itself. Both are ours, which is what
 * this guard is about; the distinction is resolved at render, not here.
 */
// `s3.twcstorage.ru` is the live Timeweb bucket host (docs/assets-manifest.yaml
// → meta.s3_public_base_url, provisioned in Issue #2), so an absolute URL of
// our own storage validates instead of being rejected.
// `s3.example-fixture.ru` exists only for the 2099 draft fixture and must be
// removed together with it.
export const ALLOWED_MEDIA_HOSTS = ['s3.twcstorage.ru', 's3.example-fixture.ru'] as const;

const mediaLocation = () =>
  z.string().refine(
    (v) => {
      if (v.startsWith('//')) return false; // protocol-relative = external
      if (v.startsWith('/')) return true; // root-relative: /media/<key> (bucket) or a site path
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
      if (v.startsWith('/')) return true; // root-relative: /media/<key> (bucket) or a site path
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

/**
 * Член оргкомитета (ТЗ §3 «оргкомитет с регалиями»).
 *
 * `photo` is a PLAIN SCALAR media location, deliberately shaped like
 * `greetingSchema.photo` and unlike `photos[]`/`cover`: a person's portrait is
 * one square derivative produced by the media pipeline, so the future CMS
 * «конструктор» emits a single URL per person, not an image object with
 * intrinsic dimensions (loader-swap invariant, AGENTS.md).
 *
 * Null is a first-class value, not a defect: «имя + регалии без фото» is the
 * card state the design sanctions (PersonCard.prompt.md), and most archive
 * years published no portraits at all.
 */
const committeeMemberSchema = z.object({
  /** Full name, verbatim (identity token — never prose-routed). */
  name: z.string(),
  regalia: proseOrNull(),
  /** Square portrait on our S3 / public path; null when none was published. */
  photo: mediaLocation().nullable().default(null),
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
  /**
   * Session-level footnotes, verbatim from the source (PR #9 review): sponsor
   * lines («Сателлитный симпозиум при поддержке компании X, не обеспечивается
   * баллами НМО») — material for a physician audience because it says the
   * session earns no NMO credits — and round-table agendas. Multiple footnote
   * lines are joined with «; ». Null = the source prints no footnote.
   */
  note: proseOrNull(),
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

/**
 * Profile slug — the last segment of `/partners/<slug>/` (Issue #24).
 *
 * Lowercase kebab-case, deliberately NOT the old site's `?i=` key: those are
 * the operator's internal ids and carry dots and mixed case (`dr.reddys`,
 * `CSCPharmaRussia`). Ours are the same slugs the rescued logo objects already
 * use (`/media/logos/dr-reddys.png`, Issue #22), so one organization has ONE
 * identifier across media and routes. The old ids survive only in
 * `infra/redirects.yaml`, which is where migration mappings belong.
 */
const PROFILE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Contact channels a partner profile publishes.
 *
 * `email` and `phone` ONLY, matching the structured contact row the source
 * platform itself models (the company website is `partnerSchema.url`, which
 * predates this block). The exhibitor free-text on the old pages sometimes also
 * carried a fax number, a second switchboard line or a messenger handle; those
 * are deliberately NOT modelled. They are 2026 artefacts of a page that is
 * being retired, not information a 2027 reader acts on, and inventing three
 * more nullable fields to carry four total values across 22 companies would
 * cost the loader-swap contract more than it returns. Nothing is lost: the
 * crawl output (`scripts/rescue-partner-profiles.mjs` → index.json) keeps every
 * captured line verbatim and is reproducible.
 *
 * `phone` is a plain string, not a normalized number: it is printed as the
 * source printed it («+7 495 955 52 57 / 58 / 40» is one company's real entry).
 */
const partnerContactsSchema = z.object({
  email: z.email().nullable().default(null),
  /** Verbatim as published — a display token, never prose-routed. */
  phone: z.string().nullable().default(null),
});

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
  /**
   * Profile page slug (Issue #24). `null` — the DEFAULT and the common case —
   * means this organization had no profile on the old site, so NO page is
   * generated for it and its card stays a plain roster entry. A slug is set
   * only where rescued content exists to fill a page: a route with nothing
   * behind it is worse than no route (ТЗ §4 «честные заглушки»).
   */
  slug: z
    .string()
    .regex(PROFILE_SLUG, 'slug must be lowercase kebab-case: a-z, 0-9 and single hyphens')
    .nullable()
    .default(null),
  /** Postal address, one line as published; null when the profile printed none. */
  address: proseOrNull(),
  /** Contact channels; null when the profile published neither email nor phone. */
  contacts: partnerContactsSchema.nullable().default(null),
  /**
   * Profile prose, ONE ENTRY PER PARAGRAPH — the organization's own description
   * of itself. An array rather than one blob because the sources run to ten
   * paragraphs including bulleted runs, and a single string would force the
   * renderer to re-invent paragraph breaks it had already been given.
   *
   * Empty (the default) is the «нет данных» state for a list, matching every
   * other collection field here; there is no separate null.
   */
  description: z.array(prose()).default([]),
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
  committee: z.array(committeeMemberSchema).default([]),
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
        /**
         * Poster frame of the click-to-load facade (Issue #33).
         *
         * `mediaLocation()`, not `videoLocation()`: the URL of the video may
         * point at YouTube/Rutube, but its POSTER is an image we serve
         * ourselves — the frames were fetched once and re-encoded into
         * `posters/` in our bucket (`scripts/rescue-video-posters.mjs`), so the
         * card never asks a foreign CDN for a pixel. That is the difference
         * between an embed link, which cannot be self-hosted, and media, which
         * ТЗ §4 says must be.
         *
         * Shaped like `cover` / `photos[]` rather than as a bare URL: `width` /
         * `height` are the intrinsic pixel dimensions the no-CLS rule
         * (AGENTS.md) needs IN THE DATA, because the derivative stops at the
         * source's own resolution — 800×450 for the 21 videos whose provider
         * publishes an HD frame, 640×360 and 480×270 for the two 2021/2022
         * uploads that only have a small one.
         *
         * `null` — the default — means no poster could be rescued; the facade
         * falls back to the dark plate it drew before, which stays a finished
         * state and not a defect.
         */
        poster: z
          .object({
            url: mediaLocation(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .nullable()
          .default(null),
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

/**
 * Two partners of the SAME year may not claim the same profile slug — that is
 * a copy-paste artifact, and it would silently make one roster entry's page
 * unreachable behind the other's (Issue #24).
 *
 * Scope is deliberately one year: a Zod schema validates one entry, and it
 * cannot see the collection. Cross-year agreement — the same slug appearing in
 * 2025 and 2026 must describe the same organization — is asserted where the
 * whole collection IS visible, in `partnerProfiles()` (`src/lib/partners.ts`).
 * Both checks are needed; neither subsumes the other.
 *
 * Kept as a separate export for the same reason as `pageSchemaChecked`: the
 * plain object schema stays composable (`.extend`, `.shape`) for tests and
 * future callers, and `content.config.ts` wires up the refined one.
 */
export const congressSchemaChecked = congressSchema.superRefine((c, ctx) => {
  const seen = new Map<string, number>();
  c.partners.forEach((p, i) => {
    if (p.slug === null) return;
    const first = seen.get(p.slug);
    if (first !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['partners', i, 'slug'],
        message: `duplicate profile slug "${p.slug}" — also used by partners[${first}] («${c.partners[first].name}»); one slug is one page`,
      });
      return;
    }
    seen.set(p.slug, i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * `page` collection — editorial copy of the static ТЗ §4 sections
 * (/program, /orgs, /nmo, /participants, /partners, /contacts, /faq, /archive,
 * home hero). ADDITIVE to the congress model above; nothing in `congressSchema`
 * changed (Issue #4 constraint).
 *
 * Why a collection and not literals in `.astro`: RU typography must be applied
 * by the `prose()` transform at the SCHEMA boundary (AGENTS.md), which requires
 * the copy to pass through a schema. It also keeps the loader-swap invariant —
 * these blocks are the same «конструктор» shapes the platform module will emit,
 * so pages stay renderers of data.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Running text: an optional heading plus plain paragraphs. */
const textBlockSchema = z.object({
  kind: z.literal('text'),
  heading: proseOrNull(),
  paragraphs: z.array(prose()).default([]),
});

/** Enumerations (formats of participation, tiers, requirements). */
const listBlockSchema = z.object({
  kind: z.literal('list'),
  heading: proseOrNull(),
  intro: proseOrNull(),
  items: z.array(prose()).default([]),
});

/**
 * Honest «в разработке» placeholder + where to go instead (ТЗ §4 principle 2).
 *
 * `linkHref` without `linkLabel` would render a focusable link whose accessible
 * name is the bare «→» arrow, so the pair is validated as a unit: an incomplete
 * link is a CONTENT error and must fail the build, not ship as a nameless link
 * (PR #14 review).
 */
/** Glyphs the Stub badge can carry — one per kind of missing content. */
export const STUB_ICONS = [
  'clock',
  'calendar',
  'photo',
  'video',
  'doc',
  'people',
  'partners',
] as const;

const stubBlockSchema = z.object({
  kind: z.literal('stub'),
  title: prose(),
  text: proseOrNull(),
  linkLabel: proseOrNull(),
  /** Internal route or in-page anchor; verbatim (a path, not copy). */
  linkHref: z.string().nullable().default(null),
  /** Badge glyph — names the TYPE of the content that is missing. */
  icon: z.enum(STUB_ICONS).default('clock'),
  /**
   * Horizontal notice form, for a stub that opens a page whose remaining
   * sections carry real (archive) content — as opposed to a stub that IS the
   * whole page state, like /program.
   */
  compact: z.boolean().default(false),
});

/** Q&A rendered as native <details> (no client JS). */
const faqBlockSchema = z.object({
  kind: z.literal('faq'),
  heading: proseOrNull(),
  items: z.array(z.object({ q: prose(), a: prose() })).default([]),
});

const pageBlockSchema = z.discriminatedUnion('kind', [
  textBlockSchema,
  listBlockSchema,
  stubBlockSchema,
  faqBlockSchema,
]);

export type PageBlock = z.infer<typeof pageBlockSchema>;

export const pageSchema = z.object({
  /** <h1> of the page. */
  title: prose(),
  /** Overline above the <h1>; null renders no overline. */
  overline: proseOrNull(),
  /** <meta name="description">. */
  description: proseOrNull(),
  /** Lead paragraphs under the heading (hero lead / section intro). */
  lead: z.array(prose()).default([]),
  /**
   * Headline figures (home hero). `value` is verbatim («100+», «22») — a
   * display token, not prose; `label` is prose.
   */
  stats: z.array(z.object({ value: z.string(), label: prose() })).default([]),
  /**
   * Caption for the figures. Load-bearing honesty: the numbers describe PAST
   * congresses and must never read as promises about 2027.
   */
  statsNote: proseOrNull(),
  blocks: z.array(pageBlockSchema).default([]),
});

/**
 * A stub's `linkHref` and `linkLabel` are validated as a PAIR: an href without
 * a label renders a focusable link whose accessible name is the bare «→»
 * arrow. That is a content error and must fail the build rather than ship
 * (PR #14 review). The check lives here, not on the block: Zod's
 * `discriminatedUnion` accepts plain objects only, so a refined member cannot
 * be a union option.
 */
export const pageSchemaChecked = pageSchema.superRefine((page, ctx) => {
  page.blocks.forEach((block, i) => {
    if (block.kind !== 'stub') return;
    if ((block.linkHref === null) !== (block.linkLabel === null)) {
      ctx.addIssue({
        // String literal, not the deprecated `z.ZodIssueCode` enum.
        code: 'custom',
        path: ['blocks', i, 'linkLabel'],
        message: 'linkHref and linkLabel must be set together — a link needs a visible label',
      });
    }
  });
});

export type Page = z.infer<typeof pageSchema>;

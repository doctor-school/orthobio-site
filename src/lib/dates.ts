/**
 * Date facts the site prints from config (Issue #98).
 *
 * The site is static: every date it shows is a build-time config value
 * (`src/config/site.ts`), never fetched. Page copy lives in YAML, which cannot
 * interpolate TypeScript and must stay plain text for the CMS loader swap, so a
 * date that page copy repeats is written there as a `{{token}}` and filled by
 * `fillContentTokensDeep` in `getPage()` (src/content/index.ts).
 *
 * Why there and not in the schema's `prose()` transform: Astro caches the
 * TRANSFORMED entries (node_modules/.astro/data-store.json) keyed on the YAML
 * file's own digest, so a value filled inside the schema goes stale when only
 * the config or an env override changes — verified: a build with an override,
 * then one without, still printed the override. `getPage()` runs after the
 * cache on every build. The token is therefore filled AFTER Typograf, so the
 * value arrives already typeset (no-break spaces placed by hand, matching what
 * Typograf emits for the same range — a unit test holds the two equal).
 */

const MOSCOW = 'Europe/Moscow';

const instant = (iso: string): number => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`dates: unparseable instant "${iso}"`);
  return ms;
};

interface MoscowDay {
  day: string;
  /** Genitive month name, as a date is written in running Russian text. */
  month: string;
  year: string;
}

const moscowDay = (iso: string): MoscowDay => {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(new Date(instant(iso)));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return { day: part('day'), month: part('month'), year: part('year') };
};

// No-break spaces bind the day to its month and «года» to the year, as
// `formatMoscowInstant` does: the result is printed both through `prose()`
// (Typograf is idempotent on it) and straight from config, which bypasses it.
// The one ordinary space left per bound is where the line may break.
const dayMonth = (d: MoscowDay): string => `${d.day}\u00a0${d.month}`;
const withYear = (d: MoscowDay): string => `${dayMonth(d)} ${d.year}\u00a0года`;

/**
 * «с 1 октября по 1 декабря 2026 года» — an inclusive range of Moscow calendar
 * days. The year is written once when both bounds share it, on each bound
 * otherwise.
 *
 * `closesAt` is EXCLUSIVE — the first moment no longer accepted, the same
 * convention as every `closesAt` in `src/config/site.ts` and the platform API.
 * «по» is inclusive, so the day printed is the last Moscow calendar day before
 * that instant: `2026-12-02T00:00:00+03:00` reads «по 1 декабря».
 */
/*#__NO_SIDE_EFFECTS__*/
export function formatMoscowDateRange(opensAt: string, closesAt: string): string {
  const closes = instant(closesAt);
  if (closes <= instant(opensAt)) {
    throw new Error(`dates: range closes (${closesAt}) before it opens (${opensAt})`);
  }
  const from = moscowDay(opensAt);
  const to = moscowDay(new Date(closes - 1).toISOString());
  // «с»/«по» are bound to the day as Typograf binds short prepositions, so the
  // config-printed range reads exactly like the same range typeset from YAML.
  return from.year === to.year
    ? `с\u00a0${dayMonth(from)} по\u00a0${withYear(to)}`
    : `с\u00a0${withYear(from)} по\u00a0${withYear(to)}`;
}

/** ISO-8601 date-time with an EXPLICIT offset (or Z): no bare dates, no local times. */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A config instant with a build-time env override. Unset or blank → the config
 * default (a GitHub Variable that does not exist reaches the build as ''). A
 * set value must be an instant with an explicit offset, or the BUILD fails
 * naming the variable: a bare «2027-04-22» parses as UTC midnight, three hours
 * off the Moscow midnight the organiser means, and would ship silently.
 *
 * `#__NO_SIDE_EFFECTS__` on this and `formatMoscowDateRange`: SignupForm's
 * browser script imports `src/config/site.ts` for `REGISTRATION_WINDOW`, and
 * without the annotation the bundler keeps every top-level call there — the
 * submission window and its Intl formatting would run in the only PII form's
 * client script. The throw is a build-time guard; the browser sees values the
 * build already accepted.
 */
/*#__NO_SIDE_EFFECTS__*/
export function instantFromEnv(name: string, raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  if (value === '') return fallback;
  if (!ISO_WITH_OFFSET.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `${name}="${value}" is not an ISO-8601 instant with an explicit offset (e.g. 2027-04-22T00:00:00+03:00)`,
    );
  }
  return value;
}

const TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Replace `{{name}}` tokens in page copy with config values. An unknown token
 * fails the build: publishing «{{submissionDeadline}}» to physicians is worse
 * than a red CI run.
 */
export function fillContentTokens(text: string, tokens: Readonly<Record<string, string>>): string {
  return text.replace(TOKEN, (_match, name: string) => {
    if (!Object.hasOwn(tokens, name)) {
      throw new Error(
        `content token {{${name}}} is not defined (known: ${Object.keys(tokens).join(', ')})`,
      );
    }
    return tokens[name];
  });
}

/**
 * `fillContentTokens` over every string of a content entry's data — arrays and
 * plain objects walked, other values returned as they are. Generic on purpose:
 * it needs no knowledge of the page schema, so a CMS loader emitting the same
 * shapes needs no change here.
 */
export function fillContentTokensDeep<T>(value: T, tokens: Readonly<Record<string, string>>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fillContentTokens(v, tokens);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

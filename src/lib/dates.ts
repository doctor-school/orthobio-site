/**
 * Date facts the site prints from config (Issues #98, #108).
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
 * Typograf emits for the same sentence spelled out — a unit test holds the two
 * equal).
 */

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
 * `#__NO_SIDE_EFFECTS__`: SignupForm's browser script imports
 * `src/config/site.ts` for `REGISTRATION_WINDOW`, and without the annotation
 * the bundler keeps every top-level call there in the only PII form's client
 * script. The throw is a build-time guard; the browser sees values the
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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const GENITIVE_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** «2027-04-23» → [2027, 4, 23]; anything but a real calendar day fails the build. */
function isoParts(iso: string): [year: number, month: number, day: number] {
  const m = ISO_DATE.exec(iso);
  const parts = m ? ([Number(m[1]), Number(m[2]), Number(m[3])] as const) : null;
  const probe = parts ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])) : null;
  if (
    !parts ||
    !probe ||
    probe.getUTCFullYear() !== parts[0] ||
    probe.getUTCMonth() !== parts[1] - 1 ||
    probe.getUTCDate() !== parts[2]
  ) {
    throw new Error(`«${iso}» is not a calendar date in the form YYYY-MM-DD`);
  }
  return [parts[0], parts[1], parts[2]];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * «2027-04-23» → «23 апреля 2027», typeset as Typograf typesets the same
 * words in running text (U+00A0 after the day, an ordinary space before the
 * year) — the value is filled into copy AFTER the Typograf pass.
 */
/*#__NO_SIDE_EFFECTS__*/
export function formatRuDay(iso: string): string {
  const [year, month, day] = isoParts(iso);
  return `${day} ${GENITIVE_MONTHS[month - 1]} ${year}`;
}

/** «1987-04-24» → «24.04.1987», the form a date-of-birth field shows. */
/*#__NO_SIDE_EFFECTS__*/
export function formatDotted(iso: string): string {
  const [year, month, day] = isoParts(iso);
  return `${pad2(day)}.${pad2(month)}.${year}`;
}

/**
 * Who is «younger than `years` on `onIso`»: born on `bornFrom` or later. Born on
 * `bornUntil` or earlier means the birthday of that age has already come by
 * that day — a person born exactly `years` years before turns `years` on it and
 * is not younger. Both ISO dates.
 *
 * A 29 February that does not exist `years` years earlier falls back to
 * 28 February: whoever was born on 1 March has not had that birthday yet.
 */
/*#__NO_SIDE_EFFECTS__*/
export function youngerThanCutoff(onIso: string, years: number): { bornFrom: string; bornUntil: string } {
  if (!Number.isInteger(years) || years <= 0) throw new Error(`age limit ${years} must be a positive integer`);
  const [year, month, day] = isoParts(onIso);
  const y = year - years;
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const until = new Date(Date.UTC(y, month - 1, Math.min(day, lastDay)));
  const from = new Date(until.getTime() + 24 * 60 * 60 * 1000);
  const iso = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return { bornFrom: iso(from), bornUntil: iso(until) };
}

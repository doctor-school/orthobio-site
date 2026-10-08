import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CONTENT_TOKENS,
  FOOTER,
  REGISTRATION_OPENS,
  REGISTRATION_WINDOW,
  SUBMISSION_DEADLINES,
  UPCOMING_CONGRESS_VENUE,
} from '../../src/config/site';
import { registrationState } from '../../src/lib/registration';

/**
 * Two kinds of owner-confirmed date live in this file, and they guard each
 * other's blind spot. Registration opens on a day; submissions close on two
 * deadlines (Issue #108). The registration matcher below only checks lines that
 * mention registration, so page copy that names a deadline on such a line
 * writes it as a token — and the deadline guard covers every line.
 *
 * The opening of registration is repeated across a dozen strings: config,
 * templates and the copy of six pages. The audit found nine hardcoded copies —
 * a shift of the date meant nine edits in different files, with no way to
 * notice a missed one (content audit М2).
 *
 * Templates read `REGISTRATION_OPENS`. Page copy CANNOT: it lives in YAML,
 * which has no interpolation and must stay plain text for the future CMS loader
 * swap (AGENTS.md «loader-swap invariant»). So the single source of truth is
 * enforced from here instead: wherever the page copy dates REGISTRATION, the
 * date must be the constant. Move the constant and this test lists every file
 * still carrying the old one.
 *
 * Issue #71 made the date an EXACT DAY («1 октября 2026»), replacing the
 * planned month. A bare month is therefore a FAILURE now, not a looser spelling
 * of the same fact: the owner asked for the day to be visible, and «в октябре
 * 2026» would quietly walk that back. The matcher below sees a bare month and
 * the day form alike, and only the day form is allowed.
 *
 * The e2e suite structurally cannot catch this — a wrong-but-plausible date is
 * valid DOM that passes both overflow and axe.
 */

const PAGES_DIR = fileURLToPath(new URL('../../src/content/pages', import.meta.url));

const MONTH_STEMS = [
  'январ',
  'феврал',
  'март',
  'апрел',
  'ма[йя]',
  'июн',
  'июл',
  'август',
  'сентябр',
  'октябр',
  'ноябр',
  'декабр',
].join('|');

/**
 * A Russian date with an optional leading day: «1 октября 2026», «ноябре 2026».
 * The day is optional ON PURPOSE — a sentence that dates registration to a bare
 * month is exactly the regression this guards against, so it has to be matched
 * before it can be rejected.
 */
const DATE_IN_PROSE = new RegExp(String.raw`(\d{1,2}\s+)?(${MONTH_STEMS})[а-яё]*\s+20\d{2}`, 'gi');

/**
 * Only lines that are ABOUT registration. The pattern above matches any date,
 * and a page is perfectly entitled to name one that has nothing to do with this
 * constant («конгресс прошёл 24-25 апреля 2026 года»): such a line would fail
 * the test and push the next author to edit the wrong string (PR #17 review).
 * The scope is the sentence, not the file, because YAML puts one editorial
 * sentence per line.
 *
 * The narrowness is load-bearing and has a cost: a line that dates registration
 * without the word is invisible here (Issue #71 found two in `partners.yaml`).
 * Widening this pattern would start failing on the legitimate past-congress
 * dates the narrowness exists to permit. New copy that dates registration must
 * contain the word; a submission deadline on the same line must be a token, not
 * a literal date. Copy that promises something BY the opening of registration
 * is a separate failure, guarded below (Issue #110).
 */
const ABOUT_REGISTRATION = /регистрац/i;

const allowed = new Set<string>([REGISTRATION_OPENS.display.toLowerCase()]);

const pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.yaml'));

/** Genitive month names, as an exact date is written in running Russian text. */
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
];

describe('REGISTRATION_OPENS is the only registration date on the site', () => {
  it('is an exact day, not a month', () => {
    // The whole point of Issue #71: «октябрь 2026» would pass a laxer check and
    // ship the vague form the owner replaced.
    expect(REGISTRATION_OPENS.display).toMatch(/^\d{1,2}\s/);
  });

  it('keeps the display form and the ISO twin in agreement', () => {
    const [day, month, year] = REGISTRATION_OPENS.display.split(' ');
    const monthIndex = GENITIVE_MONTHS.indexOf(month.toLowerCase());
    expect(monthIndex, `«${month}» is not a genitive Russian month`).toBeGreaterThanOrEqual(0);

    const iso = [
      year,
      String(monthIndex + 1).padStart(2, '0'),
      day.padStart(2, '0'),
    ].join('-');
    expect(REGISTRATION_OPENS.date).toBe(iso);
  });

  it('is the day the sign-up window opens', () => {
    // The window the /registration page evaluates must open on the same day
    // the copy announces — two constants, one fact.
    expect(REGISTRATION_WINDOW.opensAt.slice(0, 10)).toBe(REGISTRATION_OPENS.date);
  });

  it.each(pageFiles)('%s dates registration only as REGISTRATION_OPENS', (file) => {
    const body = readFileSync(`${PAGES_DIR}/${file}`, 'utf8');
    // Comments are the authors' notes, not published copy — but they carry the
    // same date and drift the same way, so they are checked too.
    const strays = body
      .split('\n')
      .filter((line) => ABOUT_REGISTRATION.test(line))
      // A sentence may name both events («…после регистрации на конгресс…
      // до {{oralTalkDeadline}}»): deadlines are tokens, not dates, so such a
      // line needs no exemption here and every literal date left on it is
      // still checked (PR #72 re-review).
      .flatMap((line) => [...line.matchAll(DATE_IN_PROSE)].map((m) => m[0].toLowerCase().trim()))
      .filter((m) => !allowed.has(m));
    expect(
      [...new Set(strays)],
      `${file} dates registration other than REGISTRATION_OPENS`,
    ).toEqual([]);
  });
});

/**
 * Issue #110: copy may not pin a promise to the opening of registration
 * («…опубликуем к открытию регистрации», «…вместе с регистрацией»). Registration
 * opens on 1 October 2026 without the organising committee, partner terms or
 * the 2027 НМО accreditation, so every such sentence turns false on that day.
 * Pending facts are «…дополнительно», as in the FAQ (Issue #109).
 *
 * Scope: page YAML, the footer placeholder and the templates — one of the
 * retired sentences lived in `partners.astro`. Comments are the authors' notes
 * and may name the retired wording to explain it, so they are skipped.
 *
 * The matcher needs the preposition that makes a deadline out of the opening
 * («к / до / с открытием, началом, стартом регистрации»): the bare noun is a
 * legitimate label — /registration prints «Открытие регистрации: 1 октября…».
 */
const PROMISE_BY_REGISTRATION =
  /(?:^|[^а-яё])(?:к|до|со?)\s+(?:открыти|начал|старт)[а-яё]*\s+регистрации|(?:вместе|одновременно)\s+с\s+регистрацией/i;
const isYamlComment = (line: string) => line.trimStart().startsWith('#');

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * SignupForm's pre-open state card («…в момент открытия регистрации») is
 * switched at runtime by the live registration window (src/lib/registration.ts),
 * so it is true by construction and out of scope of Issue #110. It is exempted
 * by name, so a promise added to any other template still fails.
 */
const EXEMPT_TEMPLATES = new Set(['components/SignupForm.astro']);

const templateFiles = ['pages', 'components']
  .flatMap((dir) =>
    readdirSync(`${SRC_DIR}/${dir}`, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.astro'))
      .map((f) => `${dir}/${f.replaceAll('\\', '/')}`),
  )
  .filter((f) => !EXEMPT_TEMPLATES.has(f));

/** Drops JS/JSX block comments, HTML comments and `//` line comments. */
const stripTemplateComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'));

describe('no copy promises anything by the opening of registration', () => {
  it.each(pageFiles)('%s pins nothing to the opening of registration', (file) => {
    const promises = readFileSync(`${PAGES_DIR}/${file}`, 'utf8')
      .split('\n')
      .filter((line) => !isYamlComment(line) && PROMISE_BY_REGISTRATION.test(line))
      .map((line) => line.trim());
    expect(promises, `${file} promises something by the opening of registration`).toEqual([]);
  });

  it('scans the templates, so the guard over them is not green on nothing', () => {
    expect(templateFiles).toEqual(expect.arrayContaining(['pages/partners.astro']));
    expect(templateFiles).not.toContain('components/SignupForm.astro');
  });

  it.each(templateFiles)('src/%s pins nothing to the opening of registration', (file) => {
    const promises = stripTemplateComments(readFileSync(`${SRC_DIR}/${file}`, 'utf8'))
      .filter((line) => PROMISE_BY_REGISTRATION.test(line))
      .map((line) => line.trim());
    expect(promises, `${file} promises something by the opening of registration`).toEqual([]);
  });

  it('the footer placeholder pins nothing to it either', () => {
    expect(FOOTER.contactsPending).not.toMatch(PROMISE_BY_REGISTRATION);
  });

  it.each([
    'состав опубликуем к открытию регистрации 1 октября 2026 года.',
    'будут подтверждены до открытия регистрации 1 октября 2026 года.',
    'адрес появится здесь вместе с открытием регистрации 1 октября 2026 года.',
    'условия участия откроются вместе с регистрацией 1 октября 2026 года.',
    'будет опубликован к открытию регистрации — {REGISTRATION_OPENS.display}.',
    'условия будут объявлены к началу регистрации.',
    'состав подтвердим до начала регистрации.',
    'программа появится к старту регистрации.',
    'условия откроются одновременно с регистрацией.',
    'адрес появится со стартом регистрации.',
  ])('the matcher recognises «%s»', (promise) => {
    expect(promise).toMatch(PROMISE_BY_REGISTRATION);
  });

  it.each([
    'Открытие регистрации: 1 октября 2026 года, 00:00 (МСК)',
    'Регистрация — с 1 октября 2026 года.',
    'после регистрации на конгресс загрузите тезисы',
    'Условия участия будут опубликованы дополнительно.',
  ])('the matcher leaves the statement of fact «%s» alone', (fact) => {
    expect(fact).not.toMatch(PROMISE_BY_REGISTRATION);
  });
});

/**
 * Issue #108 made the submission deadlines a setting: page copy writes the
 * tokens `{{oralTalkDeadline}}` / `{{posterAbstractDeadline}}` and `getPage()`
 * fills them from `SUBMISSION_DEADLINES`, so a date change is one edit in
 * `src/config/site.ts`. A page may not spell either deadline out: a literal
 * copy — even of today's correct date — is exactly the copy that stays behind
 * when the setting moves.
 *
 * Matched by the value, not by topic: a filter on «приём/подача» cannot tell
 * the 2027 deadlines from an archive fact (PR #72 review), because accepting
 * materials is equally something the 2026 congress did. Comparison is
 * nbsp-insensitive and ignores «года»: the constant carries hand-authored
 * U+00A0, the YAML is plain text, and «2027 г.» is the same stray copy.
 */
const DEADLINE_TOKENS = ['{{oralTalkDeadline}}', '{{posterAbstractDeadline}}'];
const TOKEN_IN_COPY = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;
const plainSpaces = (s: string) => s.replace(/ /g, ' ');
const spelledDeadlines = Object.values(SUBMISSION_DEADLINES).map((d) =>
  plainSpaces(d.display).replace(/ года$/, ''),
);

describe('SUBMISSION_DEADLINES are the only submission deadlines on the site', () => {
  it('reduces each deadline to the bare «day month year» the check looks for', () => {
    expect(spelledDeadlines).toEqual(['15 января 2027', '29 января 2027']);
  });

  it.each(pageFiles)('%s spells no deadline out — it uses the tokens', (file) => {
    const body = plainSpaces(readFileSync(`${PAGES_DIR}/${file}`, 'utf8'));
    const strays = spelledDeadlines.filter((d) => body.includes(d));
    expect(
      strays,
      `${file} spells a deadline out; write ${DEADLINE_TOKENS.join(' / ')} instead`,
    ).toEqual([]);
  });

  it.each(pageFiles)('%s uses only tokens the config defines', (file) => {
    const body = readFileSync(`${PAGES_DIR}/${file}`, 'utf8');
    const unknown = [...body.matchAll(TOKEN_IN_COPY)]
      .map((m) => m[1])
      .filter((name) => !Object.hasOwn(CONTENT_TOKENS, name));
    expect(unknown, `${file} uses tokens CONTENT_TOKENS does not define`).toEqual([]);
  });

  it.each(DEADLINE_TOKENS)('%s is actually published, so the guard above is not green on nothing', (token) => {
    // Without this the stray check passes trivially the day someone deletes
    // the copy. Participants owns the topic and the FAQ answers it (Issue #108
    // names both); /registration prints the constants from its template.
    const carriers = pageFiles.filter((file) =>
      readFileSync(`${PAGES_DIR}/${file}`, 'utf8').includes(token),
    );
    expect(carriers).toEqual(expect.arrayContaining(['participants.yaml', 'faq.yaml']));
  });
});

/**
 * The venue is the third repeated fact of Issue #71 — config, the FAQ answer
 * and the home meta description — and repetition without a guard is the same
 * М2 argument that produced the date checks above (PR #72 review).
 *
 * Comparison is nbsp-insensitive: the constant carries hand-authored U+00A0
 * because config strings bypass `prose()`, while the YAML stays plain text and
 * gets its nbsp from Typograf at build. Both spell the same address.
 */
const unbreak = (s: string) => s.replace(/ /g, ' ');

describe('UPCOMING_CONGRESS_VENUE is the only venue on the site', () => {
  it('names the venue inside the full address', () => {
    expect(unbreak(UPCOMING_CONGRESS_VENUE.display)).toContain(
      unbreak(UPCOMING_CONGRESS_VENUE.name),
    );
  });

  it('is the address the FAQ answers with', () => {
    const faq = unbreak(readFileSync(`${PAGES_DIR}/faq.yaml`, 'utf8'));
    expect(faq).toContain(unbreak(UPCOMING_CONGRESS_VENUE.display));
    // The retired placeholder must not come back alongside the fact.
    expect(faq).not.toContain('Площадка будет объявлена');
  });

  it('is the venue the home meta description names', () => {
    const home = unbreak(readFileSync(`${PAGES_DIR}/home.yaml`, 'utf8'));
    expect(home).toContain(unbreak(UPCOMING_CONGRESS_VENUE.name));
  });

  /**
   * Presence is only half a guard: it cannot notice a SECOND venue appearing
   * elsewhere (PR #72 re-review probed this by putting «отель «Холидей Инн
   * Сокольники»» into program.yaml — all green). The 2027 pages are the ones at
   * risk, because every past congress had a hall of its own and archive copy
   * migrating forward is the exact ТЗ §4 failure these pages exist to avoid.
   *
   * Scope: lines naming a VENUE KIND. Deliberately not a general address
   * matcher — a page may mention a street for other reasons, and a filter wide
   * enough to catch that would flag the archive's own year pages, which
   * legitimately name their halls in `src/content/congress/*.yaml` (never
   * checked here).
   *
   * What is checked is the NAME that follows the venue kind, not the kind
   * alone. The venue is a hotel complex, and since Issue #112 the pages talk
   * about it as a hotel — «Отель расположен между…», «На сайте отеля»,
   * «Контакты отеля «Милан»» — lines that name no other venue but carry the
   * word. A venue is named by a quoted name («отель «Холидей Инн
   * Сокольники»») or a capitalised one («гостиница Космос»), and every such
   * name must be the congress venue's own.
   */
  // «отел» + any ending, not an enumerated list: «в отеле» is the form copy
  // actually uses, and an ending list that misses one case is a guard that
  // reads strict and tests nothing. A hyphenated suffix («отеле-партнёре»)
  // is still the kind word; `i` covers lines set in capitals.
  const VENUE_KIND =
    /(?<![\p{L}\p{N}])(?:отел\p{L}*|гостиниц\p{L}*|конгресс-центр\p{L}*|гк)(?:-\p{L}+)*(?![\p{L}\p{N}])/giu;
  // What may stand between the kind and the name: star ratings («4*», «★★★★»).
  const QUALIFIERS = /^(?:\s+[\d*★]+)*/u;
  // The guard reads RAW YAML, before Typograf turns "…" into «…»: any opening
  // quote counts, optionally backslash-escaped inside a double-quoted scalar.
  const QUOTED_NAME = /^\s+\\?["“„«]([^"“”„»\\]+)\\?["”“»]/u;
  // Case-sensitive on purpose: «Отель расположен…» names nothing, «гостиница
  // Космос» does. A line in capitals makes every word look like a name — a
  // loud false positive, never a silent miss.
  const BARE_NAME = /^\s+(\p{Lu}[\p{L}\p{N}-]*)/u;
  const bare = (name: string) => name.replace(/[«»"“”„]/g, '').toLocaleLowerCase('ru');
  const OUR_NAME = UPCOMING_CONGRESS_VENUE.name.match(/«[^»]+»/)?.[0] ?? UPCOMING_CONGRESS_VENUE.name;
  const foreignVenues = (text: string) => {
    const line = unbreak(text);
    return [...line.matchAll(VENUE_KIND)]
      .map((m) => {
        const rest = line.slice(m.index + m[0].length);
        const after = rest.slice(QUALIFIERS.exec(rest)![0].length);
        return (QUOTED_NAME.exec(after) ?? BARE_NAME.exec(after))?.[1];
      })
      .filter((name): name is string => name !== undefined && bare(name) !== bare(OUR_NAME));
  };

  it('derives the venue name the pages may use («Милан»)', () => {
    expect(OUR_NAME).toBe('«Милан»');
  });

  it.each([
    'Конгресс пройдёт в отеле «Холидей Инн Сокольники».',
    'Площадка — гостиница Космос.',
    'Место проведения: ГК «Измайлово».',
    // Raw YAML is checked, before Typograf turns straight quotes into «…».
    'Конгресс пройдёт в отеле "Космос".',
    'Конгресс пройдёт в отеле „Космос“.',
    'Конгресс пройдёт в отеле “Космос”.',
    'Конгресс пройдёт в отеле-партнёре «Космос».',
    'Конгресс пройдёт в отеле 4* «Космос».',
    'Конгресс пройдёт в отеле 4* Космос.',
    'ОТЕЛЬ «КОСМОС»',
    'КОНГРЕСС ПРОЙДЁТ В ГОСТИНИЦЕ КОСМОС',
    'Площадка — конгресс-центр «Космос».',
    '  - "Конгресс пройдёт в отеле \\"Космос\\"."',
  ])('the matcher recognises another venue in «%s»', (line) => {
    expect(foreignVenues(line)).not.toEqual([]);
  });

  it.each([
    'Конгресс проходит в отеле «Милан» (Москва, ул. Шипиловская, 28А).',
    'Отель расположен между аэропортом «Домодедово» и центром Москвы.',
    'Забронировать на сайте отеля',
    'ГК «Милан», Москва, ул. Шипиловская, д. 28А.',
    'Контакты отеля «Милан»',
    'Конгресс проходит в отеле "Милан".',
    'ОТЕЛЬ «МИЛАН»',
    '    heading: "Контакты отеля"',
    'Для участников отель предоставляет специальные условия бронирования.',
  ])('the matcher leaves the congress venue alone in «%s»', (line) => {
    expect(foreignVenues(line)).toEqual([]);
  });

  it.each(pageFiles)('%s names no venue other than the congress hall', (file) => {
    const strays = readFileSync(`${PAGES_DIR}/${file}`, 'utf8')
      .split('\n')
      .filter((line) => foreignVenues(line).length > 0)
      .map((line) => line.trim());
    expect(strays, `${file} names a venue other than UPCOMING_CONGRESS_VENUE`).toEqual([]);
  });
});

/**
 * «Регистрация открыта» is written as a plain present-tense claim on the home
 * hero and the /participants lead (PR #118). It cannot be evaluated at build
 * time: preview and production ship the same bytes and the page is not
 * redeployed on a schedule (`src/lib/registration.ts`). So the claim is pinned
 * to the window here instead: once `REGISTRATION_WINDOW.closesAt` has passed,
 * every build fails and names the copy that has gone stale, rather than the
 * site quietly announcing an open registration after it closed.
 */
const OPEN_CLAIMS: ReadonlyArray<{ file: string; claim: string }> = [
  { file: 'src/pages/index.astro', claim: 'Регистрация открыта' },
  { file: 'src/content/pages/participants.yaml', claim: 'Регистрация на VIII конгресс открыта.' },
];

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('«Регистрация открыта» copy is pinned to REGISTRATION_WINDOW', () => {
  it.each(OPEN_CLAIMS)('$file still carries the claim this guard covers', ({ file, claim }) => {
    // Keeps the list honest: reworded copy must be re-registered here.
    expect(readFileSync(`${REPO_ROOT}${file}`, 'utf8')).toContain(claim);
  });

  it('the window is open at build time, so the claim is true', () => {
    expect(
      registrationState(REGISTRATION_WINDOW, new Date()),
      `registration is not open now (window ${REGISTRATION_WINDOW.opensAt} – ${REGISTRATION_WINDOW.closesAt}); ` +
        `reword «открыта» in: ${OPEN_CLAIMS.map((c) => c.file).join(', ')}`,
    ).toBe('open');
  });
});

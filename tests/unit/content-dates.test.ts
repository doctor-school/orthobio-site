import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FOOTER,
  REGISTRATION_OPENS,
  SUBMISSION_WINDOW,
  SUBSCRIBE_LABEL,
  UPCOMING_CONGRESS_VENUE,
} from '../../src/config/site';

/**
 * Two owner-confirmed dates live in this file, and they guard each other's
 * blind spot. Registration opens on a day; the submission window is a range
 * that STARTS on that same day and ends two months later. Page copy states them
 * in separate sentences on purpose — see the registration matcher below — so
 * each needs its own guard, or the sentence excluded from one check would be
 * covered by nothing at all.
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
 * The narrowness is load-bearing and has a cost, paid once: `partners.yaml`
 * used to date the same event as «…будут опубликованы в ноябре 2026 года»,
 * without the word, and was invisible here (Issue #71). The fix was to write
 * those sentences as what they are — «к открытию регистрации 1 октября 2026» —
 * rather than to widen this pattern, which would have started failing on the
 * legitimate past-congress dates the narrowness exists to permit. New copy that
 * dates registration must contain the word; copy about the SUBMISSION WINDOW
 * («с 1 октября по 1 декабря 2026») deliberately must not.
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

  it('is what the chrome and the CTA strings print', () => {
    expect(SUBSCRIBE_LABEL).toContain(REGISTRATION_OPENS.display);
    expect(FOOTER.contactsPending).toContain(REGISTRATION_OPENS.display);
  });

  it.each(pageFiles)('%s dates registration only as REGISTRATION_OPENS', (file) => {
    const body = readFileSync(`${PAGES_DIR}/${file}`, 'utf8');
    // Comments are the authors' notes, not published copy — but they carry the
    // same date and drift the same way, so they are checked too.
    const strays = body
      .split('\n')
      .filter((line) => ABOUT_REGISTRATION.test(line))
      // A sentence may legitimately name both events («приём открывается вместе
      // с регистрацией — с 1 октября по 1 декабря 2026 года»): the closing bound
      // is then a submission date, not a second opening date, and reporting it
      // here would send the author to edit correct copy (PR #72 review). The
      // submission guard below still holds such a line to SUBMISSION_WINDOW, so
      // the exemption is a handoff between the two halves, not a hole.
      //
      // The WINDOW is cut out of the line, not the line out of the check: an
      // exemption that drops the whole line swallows every other date on it,
      // and «Регистрация откроется в ноябре 2026 года, материалы принимаются
      // с 1 октября по 1 декабря 2026 года» would then be checked by nobody
      // (PR #72 re-review).
      .map((line) => line.replaceAll(SUBMISSION_WINDOW.display, ''))
      .flatMap((line) => [...line.matchAll(DATE_IN_PROSE)].map((m) => m[0].toLowerCase().trim()))
      .filter((m) => !allowed.has(m));
    expect(
      [...new Set(strays)],
      `${file} dates registration other than REGISTRATION_OPENS`,
    ).toEqual([]);
  });
});

/**
 * A «с <дата> по <дата> <год>» range, matched by SHAPE rather than by topic.
 *
 * Topic was the first attempt and it was wrong (PR #72 review): a filter on
 * «приём/подача» cannot tell the future window from an archive fact, because
 * unlike «регистрация» — which on this site is always the 2027 event — accepting
 * materials is equally something the 2026 congress did. «На конгрессе 2026 года
 * тезисы принимались до 25 февраля 2026 года» is legitimate copy that a topical
 * filter flags. The range shape is what the published window actually looks
 * like, and archive sentences do not wear it.
 */
const RANGE_IN_PROSE = new RegExp(
  String.raw`с \d{1,2} (?:${MONTH_STEMS})[а-яё]* по \d{1,2} (?:${MONTH_STEMS})[а-яё]*\s+20\d{2}`,
  'gi',
);

describe('SUBMISSION_WINDOW is the only submission window on the site', () => {
  it('keeps the display range and the ISO twins in agreement', () => {
    const parsed = SUBMISSION_WINDOW.display.match(
      /^с (\d{1,2}) (\S+) по (\d{1,2}) (\S+) (\d{4})$/,
    );
    expect(parsed, `«${SUBMISSION_WINDOW.display}» is not a «с <дата> по <дата> <год>» range`)
      .not.toBeNull();
    const [, fromDay, fromMonth, toDay, toMonth, year] = parsed!;

    const iso = (day: string, month: string) => {
      const monthIndex = GENITIVE_MONTHS.indexOf(month.toLowerCase());
      expect(monthIndex, `«${month}» is not a genitive Russian month`).toBeGreaterThanOrEqual(0);
      return [year, String(monthIndex + 1).padStart(2, '0'), day.padStart(2, '0')].join('-');
    };

    // The year is written once, at the end of the range: both bounds carry it.
    expect(SUBMISSION_WINDOW.startDate).toBe(iso(fromDay, fromMonth));
    expect(SUBMISSION_WINDOW.endDate).toBe(iso(toDay, toMonth));
    expect(SUBMISSION_WINDOW.endDate > SUBMISSION_WINDOW.startDate).toBe(true);
  });

  it.each(pageFiles)('%s states any date range as SUBMISSION_WINDOW', (file) => {
    const body = readFileSync(`${PAGES_DIR}/${file}`, 'utf8');
    // Whole ranges, not the dates inside them: «с 1 сентября по 1 декабря 2026»
    // yields only ONE full date to a per-date check («1 декабря 2026», the
    // opening bound carries no year of its own), so a wrong opening bound would
    // pass. The window is the only range these pages publish.
    const strays = [...body.matchAll(RANGE_IN_PROSE)]
      .map((m) => m[0])
      .filter((range) => range !== SUBMISSION_WINDOW.display);
    expect(
      [...new Set(strays)],
      `${file} states a date range other than SUBMISSION_WINDOW`,
    ).toEqual([]);
  });

  it('is actually published, so the guard above is not green on nothing', () => {
    // Without this the whole check passes trivially the day someone deletes the
    // copy: no range in the file, no stray. Asserting WHICH files carry it would
    // fail the day a third page legitimately states the window, so this only
    // demands that the copy exists somewhere and on the page that owns the topic.
    const carriers = pageFiles.filter((file) =>
      readFileSync(`${PAGES_DIR}/${file}`, 'utf8').includes(SUBMISSION_WINDOW.display),
    );
    expect(carriers).toContain('participants.yaml');
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
   */
  // «отел» + any letter, not an enumerated ending: «в отеле» is the form copy
  // actually uses, and an ending list that misses one case is a guard that
  // reads strict and tests nothing.
  const NAMES_A_VENUE = /отел[а-яё]|гостиниц|конгресс-центр|ГК «/i;

  it.each(pageFiles)('%s names no venue other than the congress hall', (file) => {
    const strays = unbreak(readFileSync(`${PAGES_DIR}/${file}`, 'utf8'))
      .split('\n')
      .filter((line) => NAMES_A_VENUE.test(line))
      .map((line) => line.trim())
      .filter((line) => !line.includes(unbreak(UPCOMING_CONGRESS_VENUE.name)));
    expect(strays, `${file} names a venue other than UPCOMING_CONGRESS_VENUE`).toEqual([]);
  });
});

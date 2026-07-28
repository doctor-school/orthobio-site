import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FOOTER, REGISTRATION_OPENS, SUBSCRIBE_LABEL } from '../../src/config/site';

/**
 * The planned opening of registration («ноябрь 2026») is a PLAN, not an
 * announced date, and it is repeated across a dozen strings: config, templates
 * and the copy of six pages. The audit found nine hardcoded copies — a shift of
 * the date meant nine edits in different files, with no way to notice a missed
 * one (content audit М2).
 *
 * Templates now read `REGISTRATION_OPENS`. Page copy CANNOT: it lives in YAML,
 * which has no interpolation and must stay plain text for the future CMS loader
 * swap (AGENTS.md «loader-swap invariant»). So the single source of truth is
 * enforced from here instead: wherever the page copy dates REGISTRATION, the
 * month+year must be one of the two grammatical forms of the constant. Move the
 * constant and this test lists every file still carrying the old date.
 *
 * The e2e suite structurally cannot catch this — a wrong-but-plausible date is
 * valid DOM that passes both overflow and axe.
 */

const PAGES_DIR = fileURLToPath(new URL('../../src/content/pages', import.meta.url));

/** Any «<месяц> <год>» in Russian, in any case form. */
const MONTH_YEAR =
  /(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*\s+20\d{2}/gi;

/**
 * Only lines that are ABOUT registration. The pattern above matches any month
 * and year, and a page is perfectly entitled to name one that has nothing to do
 * with this constant («конгресс прошёл 24-25 апреля 2026 года»): such a line
 * would fail the test and push the next author to edit the wrong string
 * (PR #17 review). The scope is the sentence, not the file, because YAML puts
 * one editorial sentence per line.
 */
const ABOUT_REGISTRATION = /регистрац/i;

const allowed = new Set<string>([
  REGISTRATION_OPENS.nominative.toLowerCase(),
  REGISTRATION_OPENS.prepositional.toLowerCase(),
]);

const pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.yaml'));

describe('REGISTRATION_OPENS is the only registration date on the site', () => {
  it('exposes both grammatical forms of the same month and year', () => {
    const year = (form: string) => form.match(/20\d{2}/)?.[0];
    expect(year(REGISTRATION_OPENS.nominative)).toBe(year(REGISTRATION_OPENS.prepositional));
    // The two forms must be the same MONTH. Comparing a fixed-length prefix
    // asserted that the stem is at least that long: `slice(0, 5)` happens to
    // work for «ноябрь»/«ноябре» and would fail on «май»/«мае» — a green test
    // that breaks when the date moves is worse than none (PR #17 review).
    // The month is the first word; the case ending is its last letter.
    const stem = (form: string) => form.split(' ')[0].slice(0, -1);
    expect(stem(REGISTRATION_OPENS.nominative)).toBe(stem(REGISTRATION_OPENS.prepositional));
  });

  it('is what the chrome and the CTA strings print', () => {
    expect(SUBSCRIBE_LABEL).toContain(REGISTRATION_OPENS.prepositional);
    expect(FOOTER.contactsPending).toContain(REGISTRATION_OPENS.nominative);
  });

  it.each(pageFiles)('%s dates registration only as REGISTRATION_OPENS', (file) => {
    const body = readFileSync(`${PAGES_DIR}/${file}`, 'utf8');
    // Comments are the authors' notes, not published copy — but they carry the
    // same date and drift the same way, so they are checked too.
    const strays = body
      .split('\n')
      .filter((line) => ABOUT_REGISTRATION.test(line))
      .flatMap((line) => [...line.matchAll(MONTH_YEAR)].map((m) => m[0].toLowerCase()))
      .filter((m) => !allowed.has(m));
    expect(
      [...new Set(strays)],
      `${file} dates registration other than REGISTRATION_OPENS`,
    ).toEqual([]);
  });
});

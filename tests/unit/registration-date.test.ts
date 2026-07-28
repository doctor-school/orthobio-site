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
 * enforced from here instead: every month+year the page copy names must be one
 * of the two grammatical forms of the constant. Move the constant and this test
 * lists every file still carrying the old date.
 *
 * The e2e suite structurally cannot catch this — a wrong-but-plausible date is
 * valid DOM that passes both overflow and axe.
 */

const PAGES_DIR = fileURLToPath(new URL('../../src/content/pages', import.meta.url));

/** Any «<месяц> <год>» in Russian, in any case form. */
const MONTH_YEAR =
  /(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*\s+20\d{2}/gi;

const allowed = new Set<string>([
  REGISTRATION_OPENS.nominative.toLowerCase(),
  REGISTRATION_OPENS.prepositional.toLowerCase(),
]);

const pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.yaml'));

describe('REGISTRATION_OPENS is the only registration date on the site', () => {
  it('exposes both grammatical forms of the same month and year', () => {
    const year = (form: string) => form.match(/20\d{2}/)?.[0];
    expect(year(REGISTRATION_OPENS.nominative)).toBe(year(REGISTRATION_OPENS.prepositional));
    expect(REGISTRATION_OPENS.nominative.slice(0, 5)).toBe(
      REGISTRATION_OPENS.prepositional.slice(0, 5),
    );
  });

  it('is what the chrome and the CTA strings print', () => {
    expect(SUBSCRIBE_LABEL).toContain(REGISTRATION_OPENS.prepositional);
    expect(FOOTER.contactsPending).toContain(REGISTRATION_OPENS.nominative);
  });

  it.each(pageFiles)('%s names no other month and year', (file) => {
    const body = readFileSync(`${PAGES_DIR}/${file}`, 'utf8');
    // Comments are the authors' notes, not published copy — but they carry the
    // same date and drift the same way, so they are checked too.
    const found = [...body.matchAll(MONTH_YEAR)].map((m) => m[0].toLowerCase());
    const strays = [...new Set(found)].filter((m) => !allowed.has(m));
    expect(strays, `${file} names a date other than REGISTRATION_OPENS`).toEqual([]);
  });
});

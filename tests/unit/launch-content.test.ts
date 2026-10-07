import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  CONTACT_EMAIL,
  CONTACT_PHONE,
  CONTENT_TOKENS,
  REGISTRATION_OPENS,
  FOOTER_LINKS,
  NAV,
  REGISTRATION_CTA_LABEL,
  REGISTRATION_URL,
  SUBMISSION_DEADLINES,
  UPCOMING_CONGRESS_VENUE,
} from '../../src/config/site';
import { typographize } from '../../src/content/typographize';
import { fillContentTokens } from '../../src/lib/dates';

describe('owner-approved pre-registration launch content', () => {
  it('points the home-page CTA at the on-site registration form (Issue #78)', () => {
    expect(REGISTRATION_OPENS.display).toBe('1 октября 2026');
    expect(REGISTRATION_OPENS.date).toBe('2026-10-01');
    // Internal route, not an outbound channel: the page itself shows the form
    // or the «откроется …» state, so the CTA is honest before the opening day.
    expect(REGISTRATION_URL).toBe('/registration');
    expect(REGISTRATION_CTA_LABEL).toBe('Регистрация на конгресс');
  });

  it('lists the sign-up routes in the footer sitemap but not in the nav', () => {
    const footer = FOOTER_LINKS.map(({ href, label }) => ({ href, label }));
    expect(footer).toContainEqual({ href: '/registration', label: 'Регистрация' });
    expect(footer).toContainEqual({ href: '/privacy', label: 'Политика конфиденциальности' });
    const nav: readonly string[] = NAV.map(({ href }) => href);
    expect(nav).not.toContain('/registration');
    expect(nav).not.toContain('/privacy');
  });

  it('publishes the Doctor.School manager contacts', () => {
    expect(CONTACT_EMAIL).toBe('manager@doctor.school');
    expect(CONTACT_PHONE).toBe('8 (495) 410-04-90');
  });

  // Values, not geometry: the e2e sweep stays green on a plausible-but-wrong
  // address, the way «фото 12» shipped past it in PR #14.
  it('publishes the owner-confirmed venue with hand-authored RU typography', () => {
    // Config strings bypass the Content Layer's `prose()` transform, so the
    // nbsp that keeps «ул. Шипиловская» / «д. 28А» unbroken on a 360px viewport
    // is written into the constant and asserted here.
    expect(UPCOMING_CONGRESS_VENUE.display).toBe(
      'ГК «Милан», Москва, ул. Шипиловская, д. 28А',
    );
    expect(UPCOMING_CONGRESS_VENUE.name).toBe('ГК «Милан»');
  });

  it('publishes the organisers’ 2027 submission deadlines (Issue #108)', () => {
    // ТЗ «подача материалов на Конгресс 2027», п. 4: oral talks until
    // 15 January, posters and abstracts until 29 January 2027.
    const NB = ' ';
    expect(SUBMISSION_DEADLINES.oralTalk.date).toBe('2027-01-15');
    expect(SUBMISSION_DEADLINES.oralTalk.display).toBe(`15${NB}января 2027${NB}года`);
    expect(SUBMISSION_DEADLINES.posterAbstract.date).toBe('2027-01-29');
    expect(SUBMISSION_DEADLINES.posterAbstract.display).toBe(`29${NB}января 2027${NB}года`);
    // Page copy sees exactly these values, under these names: the two
    // deadlines, and the first congress day with the poster birth-date bounds
    // the submission guide prints (Issue #99).
    expect(CONTENT_TOKENS).toEqual({
      oralTalkDeadline: SUBMISSION_DEADLINES.oralTalk.display,
      posterAbstractDeadline: SUBMISSION_DEADLINES.posterAbstract.display,
      congressStartDay: `23${NB}апреля 2027`,
      posterBornFrom: '24.04.1987',
      posterBornUntil: '23.04.1987',
    });
  });

  // getPage() fills tokens AFTER the schema's Typograf pass (src/lib/dates.ts
  // says why), so the hand-typeset value must read exactly as Typograf would
  // have typeset the same sentence spelled out — nbsp included.
  const tokenSentences = ['participants.yaml', 'zapolnit-zayavku.yaml', 'faq.yaml'].flatMap((file) => {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        if (/\{\{[A-Za-z][A-Za-z0-9]*\}\}/.test(v)) strings.push(v);
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(parse(readFileSync(fileURLToPath(new URL(`../../src/content/pages/${file}`, import.meta.url)), 'utf8')));
    return strings;
  });

  it('finds the token sentences it checks', () => {
    expect(tokenSentences.length).toBeGreaterThanOrEqual(3);
  });

  it.each(tokenSentences)('fills «%s» exactly as if the value were spelled out', (sentence) => {
    expect(fillContentTokens(typographize(sentence), CONTENT_TOKENS)).toBe(
      typographize(fillContentTokens(sentence, CONTENT_TOKENS)),
    );
  });
});

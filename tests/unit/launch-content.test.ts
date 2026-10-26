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
  type NavItem,
  REGISTRATION_CTA_LABEL,
  REGISTRATION_URL,
  SUBMISSION_DEADLINE,
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

  // The green highlight is a header-only flag (Issue #122): exactly one nav
  // item carries it, and the route it points at must still reach the footer map.
  it('marks «Консенсусы» as the only accent nav item and keeps it in the footer', () => {
    const items: readonly NavItem[] = NAV;
    const accented = items.filter((item) => item.accent);
    expect(accented).toHaveLength(1);
    expect(accented[0]).toMatchObject({ href: '/consensus', label: 'Консенсусы', accent: true });
    const footer = FOOTER_LINKS.map(({ href, label }) => ({ href, label }));
    expect(footer).toContainEqual({ href: '/consensus', label: 'Консенсусы' });
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

  it('publishes the one submission deadline the organisers set (Issue #127)', () => {
    // Oral talks, poster talks and abstracts all close on 18 December 2026.
    const NB = ' ';
    expect(SUBMISSION_DEADLINE.date).toBe('2026-12-18');
    expect(SUBMISSION_DEADLINE.display).toBe(`18${NB}декабря 2026${NB}года`);
    // Page copy sees exactly these values, under these names: the deadline,
    // and the first congress day with the poster birth-date bounds the
    // submission guide prints (Issue #99).
    expect(CONTENT_TOKENS).toEqual({
      submissionDeadline: SUBMISSION_DEADLINE.display,
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

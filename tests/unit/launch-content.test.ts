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
  SUBMISSION_WINDOW,
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

  it('opens the submission window with registration and closes it two months later', () => {
    // Issue #98: a setting of two Moscow instants; the display is derived.
    expect(SUBMISSION_WINDOW.opensAt).toBe('2026-10-01T00:00:00+03:00');
    expect(SUBMISSION_WINDOW.opensAt.slice(0, 10)).toBe(REGISTRATION_OPENS.date);
    // Inclusive «по 1 декабря»: the last accepted moment of that Moscow day.
    expect(SUBMISSION_WINDOW.closesAt).toBe('2026-12-01T23:59:59+03:00');
    expect(SUBMISSION_WINDOW.display).toBe('с\u00a01\u00a0октября по\u00a01\u00a0декабря 2026\u00a0года');
  });

  it('offers the submission window to page copy as the {{submissionWindow}} token', () => {
    expect(CONTENT_TOKENS.submissionWindow).toBe(SUBMISSION_WINDOW.display);
  });

  // getPage() fills tokens AFTER the schema's Typograf pass (src/lib/dates.ts
  // says why), so the hand-typeset value must read exactly as Typograf would
  // have typeset the same sentence spelled out — nbsp included.
  const tokenSentences = ['participants.yaml', 'faq.yaml'].flatMap((file) => {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        if (v.includes('{{submissionWindow}}')) strings.push(v);
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(parse(readFileSync(fileURLToPath(new URL(`../../src/content/pages/${file}`, import.meta.url)), 'utf8')));
    return strings;
  });

  it('finds the token sentences it checks', () => {
    expect(tokenSentences.length).toBeGreaterThanOrEqual(3);
  });

  it.each(tokenSentences)('fills «%s» exactly as if the range were spelled out', (sentence) => {
    expect(fillContentTokens(typographize(sentence), CONTENT_TOKENS)).toBe(
      typographize(fillContentTokens(sentence, CONTENT_TOKENS)),
    );
  });
});

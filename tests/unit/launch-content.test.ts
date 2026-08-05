import { describe, expect, it } from 'vitest';

import {
  CONTACT_EMAIL,
  CONTACT_PHONE,
  REGISTRATION_OPENS,
  SUBMISSION_WINDOW,
  SUBSCRIBE_URL,
  UPCOMING_CONGRESS_VENUE,
} from '../../src/config/site';

describe('owner-approved pre-registration launch content', () => {
  it('ships without a subscription CTA before registration opens', () => {
    expect(REGISTRATION_OPENS.display).toBe('1 октября 2026');
    expect(REGISTRATION_OPENS.date).toBe('2026-10-01');
    expect(SUBSCRIBE_URL).toBeNull();
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
    expect(SUBMISSION_WINDOW.display).toBe('с 1 октября по 1 декабря 2026');
    expect(SUBMISSION_WINDOW.startDate).toBe(REGISTRATION_OPENS.date);
    expect(SUBMISSION_WINDOW.endDate).toBe('2026-12-01');
  });
});

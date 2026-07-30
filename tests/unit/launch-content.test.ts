import { describe, expect, it } from 'vitest';

import {
  CONTACT_EMAIL,
  CONTACT_PHONE,
  REGISTRATION_OPENS,
  SUBSCRIBE_URL,
} from '../../src/config/site';

describe('owner-approved pre-registration launch content', () => {
  it('ships without a subscription CTA before registration opens', () => {
    expect(REGISTRATION_OPENS.nominative).toBe('ноябрь 2026');
    expect(SUBSCRIBE_URL).toBeNull();
  });

  it('publishes the Doctor.School manager contacts', () => {
    expect(CONTACT_EMAIL).toBe('manager@doctor.school');
    expect(CONTACT_PHONE).toBe('8 (495) 410-04-90');
  });
});

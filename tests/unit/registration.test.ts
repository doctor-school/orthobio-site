import { describe, expect, it } from 'vitest';

import { REGISTRATION_WINDOW } from '../../src/config/site';
import {
  FORCE_OPEN_HOSTS,
  formatMoscowInstant,
  registrationState,
  type RegistrationWindow,
} from '../../src/lib/registration';

const WINDOW: RegistrationWindow = {
  opensAt: '2026-10-01T00:00:00+03:00',
  closesAt: '2027-04-20T00:00:00+03:00',
};

const at = (iso: string) => new Date(iso);

describe('registrationState', () => {
  it('is not-yet-open before the opening instant', () => {
    expect(registrationState(WINDOW, at('2026-09-30T23:59:59+03:00'))).toBe('not-yet-open');
  });

  it('opens exactly at the opening instant, whatever zone the clock is read in', () => {
    // 2026-09-30T21:00Z is midnight in Moscow.
    expect(registrationState(WINDOW, at('2026-09-30T21:00:00Z'))).toBe('open');
  });

  it('is open inside the window', () => {
    expect(registrationState(WINDOW, at('2027-01-15T12:00:00+03:00'))).toBe('open');
  });

  it('is closed from the closing instant on', () => {
    expect(registrationState(WINDOW, at('2027-04-20T00:00:00+03:00'))).toBe('closed');
    expect(registrationState(WINDOW, at('2027-05-01T00:00:00+03:00'))).toBe('closed');
  });

  it('never closes while the closing instant is null', () => {
    const open = { ...WINDOW, closesAt: null };
    expect(registrationState(open, at('2030-01-01T00:00:00Z'))).toBe('open');
  });

  it('force-opens the preview and local hosts only when a hostname is given', () => {
    const before = at('2026-01-01T00:00:00Z');
    for (const host of FORCE_OPEN_HOSTS) {
      expect(registrationState(WINDOW, before, host)).toBe('open');
    }
    expect(registrationState(WINDOW, before)).toBe('not-yet-open');
    expect(registrationState(WINDOW, before, null)).toBe('not-yet-open');
    expect(registrationState(WINDOW, before, 'orthobio.ru')).toBe('not-yet-open');
  });

  it('keeps production out of the force-open list', () => {
    expect(FORCE_OPEN_HOSTS).not.toContain('orthobio.ru');
    expect(FORCE_OPEN_HOSTS).not.toContain('www.orthobio.ru');
  });

  it('throws on an unparseable instant instead of guessing', () => {
    expect(() => registrationState({ opensAt: 'октябрь', closesAt: null }, new Date())).toThrow(
      /unparseable/,
    );
    expect(() =>
      registrationState({ opensAt: WINDOW.opensAt, closesAt: 'потом' }, at('2027-01-01T00:00:00Z')),
    ).toThrow(/unparseable/);
  });
});

describe('formatMoscowInstant', () => {
  it('prints the opening instant in Moscow time with «года»', () => {
    expect(formatMoscowInstant('2026-10-01T00:00:00+03:00')).toBe(
      '1 октября 2026 года, 00:00 (мск)',
    );
  });

  it('converts an instant given in another zone to Moscow time', () => {
    expect(formatMoscowInstant('2026-10-01T09:30:00Z')).toBe('1 октября 2026 года, 12:30 (мск)');
  });

  it('throws on an unparseable instant', () => {
    expect(() => formatMoscowInstant('скоро')).toThrow(/unparseable/);
  });
});

describe('REGISTRATION_WINDOW', () => {
  it('opens at the owner-confirmed instant, midnight Moscow on 1 October 2026', () => {
    expect(REGISTRATION_WINDOW.opensAt).toBe('2026-10-01T00:00:00+03:00');
  });

  it('has no closing instant until the owner supplies one (ds-platform#2292)', () => {
    expect(REGISTRATION_WINDOW.closesAt).toBeNull();
  });
});

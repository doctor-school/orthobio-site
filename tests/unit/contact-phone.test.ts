import { describe, expect, it } from 'vitest';

import { isValidContactPhone, normaliseContactPhone } from '../../src/lib/contact-phone';

/** Site half of 044 EARS-29: the typed phone is kept, its normalised form validated. */
describe('normaliseContactPhone', () => {
  it('turns a domestic 8-prefixed number into +7', () => {
    expect(normaliseContactPhone('8 (999) 123-45-67')).toBe('+79991234567');
  });

  it('keeps an international number, dropping the punctuation', () => {
    expect(normaliseContactPhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normaliseContactPhone('+7 999 123 45 67')).toBe('+79991234567');
  });

  it('returns an empty string when nothing was typed', () => {
    expect(normaliseContactPhone('')).toBe('');
    expect(normaliseContactPhone('  ()- ')).toBe('');
  });

  it('caps the result at the 15 digits E.164 allows', () => {
    expect(normaliseContactPhone('1234567890123456789')).toBe('+123456789012345');
  });
});

describe('isValidContactPhone', () => {
  it.each(['+7 (999) 123-45-67', '8 (999) 123-45-67', '+49 30 1234567'])('accepts %j', (typed) => {
    expect(isValidContactPhone(typed)).toBe(true);
  });

  it.each(['', '12345', 'телефон', '0 999 123 45 67'])('refuses %j', (typed) => {
    expect(isValidContactPhone(typed)).toBe(false);
  });
});

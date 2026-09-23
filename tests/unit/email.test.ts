import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';

import { isPlatformEmail, PLATFORM_EMAIL } from '../../src/lib/email';

describe('isPlatformEmail', () => {
  it.each(['ivanov@example.com', 'a.b+tag@mail.co.uk', "o'neil@clinic.ru", 'x_y-z@sub-domain.example.org'])(
    'accepts %s',
    (email) => expect(isPlatformEmail(email)).toBe(true),
  );

  it.each(['a@b', 'иванов@почта.рф', 'user@почта.рф', '.lead@example.com', 'a..b@example.com', 'a@example.c', 'a @example.com', ''])(
    'refuses %s',
    (email) => expect(isPlatformEmail(email)).toBe(false),
  );

  it('is the very pattern zod 4 uses for z.email()', () => {
    expect(PLATFORM_EMAIL.source).toBe(z.regexes.email.source);
  });
});

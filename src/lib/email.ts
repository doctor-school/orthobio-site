/**
 * E-mail check — the site half of the platform intake's `z.email()`.
 *
 * The browser's `type=email` validity accepts `a@b` and IDN/Cyrillic
 * addresses; the platform's zod v4 default pattern (`z.regexes.email`, copied
 * here verbatim from zod 4) refuses both with a 400. Checking the same pattern
 * before sending reports the problem next to the field instead of as a
 * form-level refusal.
 */
export const PLATFORM_EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export const isPlatformEmail = (typed: string): boolean => PLATFORM_EMAIL.test(typed);

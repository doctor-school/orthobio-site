/**
 * Contact-phone normalisation — the site half of platform 044 EARS-29
 * (`packages/schemas/src/congress/contact-phone.ts`), ported verbatim.
 *
 * The intake keeps the phone exactly as typed and validates the NORMALISED
 * form against E.164, so «+7 (999) 123-45-67» — the shape the placeholder
 * invites — is a valid phone. The form runs the same check before sending so
 * a typo is reported next to the field instead of as a generic refusal.
 */

export const E164 = /^\+[1-9]\d{6,14}$/;

export function normaliseContactPhone(typed: string): string {
  const digits = typed.replace(/\D/g, '');
  if (digits === '') return '';
  const domestic = digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
  return `+${domestic.slice(0, 15)}`;
}

/** Whether the typed phone would pass the intake contract. */
export const isValidContactPhone = (typed: string): boolean =>
  E164.test(normaliseContactPhone(typed));

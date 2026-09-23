/**
 * Name-answer normalisation — the SITE HALF of one rule (Issue #78, comment
 * of 2026-09-22; platform 044 EARS-33, `packages/schemas/src/congress/name-answer.ts`).
 *
 * The platform normalises surname, first name and patronymic on intake and
 * stores only the normalised value. The form applies the same rule on blur so
 * the participant sees the stored spelling before pressing the button; the
 * server remains the source of truth and this function is a courtesy, never a
 * gate. The two implementations must agree character for character, which is
 * why this is a verbatim port rather than a «similar» rule.
 *
 * Idempotent by construction: a second pass changes nothing.
 */

const WHITESPACE_RUN = /\s+/gu;
/** A segment ends at a space, a hyphen or an apostrophe; separators are kept. */
const SEGMENT = /[^ '’-]+/gu;

export function normaliseNameAnswer(typed: string): string {
  const collapsed = typed.replace(WHITESPACE_RUN, ' ').trim();
  return collapsed.replace(
    SEGMENT,
    (segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase(),
  );
}

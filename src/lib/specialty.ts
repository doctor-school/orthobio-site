/**
 * Specialty lookup for the sign-up form: the list comes from the platform
 * (`/v1/public/specialties`) and only an id from it may be sent — no free text.
 *
 * Exact name first (case-insensitive). Failing that, a fragment that occurs in
 * exactly ONE name picks it: where datalist suggestions render poorly (some
 * Android browsers, some screen readers), a participant should not have to
 * type «Травматология и ортопедия» letter for letter. Short fragments never
 * resolve, so two typed letters cannot silently pick a specialty.
 */
export interface SpecialtyOption {
  id: string;
  name: string;
}

export const MIN_FRAGMENT = 4;

export function matchSpecialty<T extends SpecialtyOption>(
  list: readonly T[],
  typed: string,
  { allowFragment = true } = {},
): T | null {
  const needle = typed.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  if (needle === '') return null;
  const exact = list.find((s) => s.name.toLocaleLowerCase('ru') === needle);
  if (exact) return exact;
  if (!allowFragment || needle.length < MIN_FRAGMENT) return null;
  const hits = list.filter((s) => s.name.toLocaleLowerCase('ru').includes(needle));
  return hits.length === 1 ? hits[0] : null;
}

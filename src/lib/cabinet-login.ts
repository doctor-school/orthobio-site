/**
 * «Войти в кабинет» on the sign-up success card (Issue #116; platform 044
 * EARS-39, 003 EARS-44). An accepted sign-up answers `{status, handoff}`: a
 * personal reference, live for a day, that opens the platform's sign-in page
 * on the code step with the code already sent. It is a credential in all but
 * name, so the success card puts it in exactly one place — the button's href —
 * and nowhere else: no log, no analytics, no storage, no address bar.
 *
 * An API that predates the hand-off answers without the field; the button then
 * is the plain configured sign-in link, where the participant types the
 * address themselves.
 */

/** The hand-off reference of a sign-up response body, or null when there is none. */
export const handoffFrom = (body: unknown): string | null => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const ref = (body as { handoff?: unknown }).handoff;
  return typeof ref === 'string' && ref.trim() !== '' ? ref : null;
};

/**
 * `base` (CABINET_LOGIN_URL) with `handoff=<ref>` right after the `method`
 * parameter — the order the platform documents. Built on the string rather
 * than `URL.searchParams`, which would re-encode the configured `returnTo`.
 */
export const cabinetLoginHref = (base: string, handoff: string | null): string => {
  if (handoff === null) return base;
  const q = base.indexOf('?');
  const path = q === -1 ? base : base.slice(0, q);
  const params = q === -1 || q === base.length - 1 ? [] : base.slice(q + 1).split('&');
  const at = params.findIndex((p) => p.startsWith('method=')) + 1;
  params.splice(at, 0, `handoff=${encodeURIComponent(handoff)}`);
  return `${path}?${params.join('&')}`;
};

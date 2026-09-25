/**
 * Registration window as the SITE sees it (Issue #78; platform 044 EARS-28).
 *
 * Enforcement lives in the platform API — its env pair
 * `CONGRESS_SIGNUP_WINDOW_OPENS_AT` / `…_CLOSES_AT` refuses a submission
 * outside the window before any side effect. The site only DISPLAYS the two
 * states, «откроется …» and «закрыта», and hides the form in both. The instants
 * here and the API's must be the same instants; keeping them equal is a launch
 * check on ds-platform#2292, because they live in two repositories.
 *
 * Evaluated in the BROWSER, not at build time: preview and production serve one
 * and the same release bytes (infra/nginx/*.conf), so a build-time switch could
 * not open the form on `new.orthobio.ru` for the owner's review while keeping
 * it closed on `orthobio.ru`, and it would need a redeploy on the opening day.
 * Pure functions, so the rule is unit-tested and the page script stays a thin
 * caller.
 */

export interface RegistrationWindow {
  /** ISO-8601 instant with an explicit offset — never a bare date. */
  opensAt: string;
  /** `null` means no closing instant is configured: the window never closes. */
  closesAt: string | null;
}

export type RegistrationState = 'not-yet-open' | 'open' | 'closed';

/**
 * Hosts on which the form is shown regardless of the window: the preview
 * vhost, where the owner reviews the form before the opening day, and the local
 * preview server the e2e suite runs against. Production is deliberately absent.
 */
export const FORCE_OPEN_HOSTS = ['new.orthobio.ru', 'localhost', '127.0.0.1'] as const;

const instant = (iso: string): number => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`registration window: unparseable instant "${iso}"`);
  return ms;
};

export function registrationState(
  window: RegistrationWindow,
  now: Date,
  hostname: string | null = null,
): RegistrationState {
  if (hostname !== null && (FORCE_OPEN_HOSTS as readonly string[]).includes(hostname)) {
    return 'open';
  }
  const t = now.getTime();
  if (t < instant(window.opensAt)) return 'not-yet-open';
  if (window.closesAt !== null && t >= instant(window.closesAt)) return 'closed';
  return 'open';
}

/**
 * «1 октября 2026 года, 00:00 (МСК)» — the opening instant as the state card
 * prints it. Moscow time explicitly, because the API's instant carries its own
 * offset and a participant in another zone must read the same clock the
 * organiser set.
 *
 * Typeset with no-break spaces where Russian typography binds the words: the
 * day to its month, «года» to the year and «(МСК)» to the time — so a heading
 * never breaks as «1 / октября» (PR #87 audit, at 1440px). Built from parts,
 * not by patching Intl's string, whose own spacing differs between ICU builds.
 */
export function formatMoscowInstant(iso: string): string {
  const date = new Date(instant(iso));
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  // Intl says «2026 г.»; the site's own convention is «года».
  return `${part('day')}\u00a0${part('month')} ${part('year')}\u00a0года, ${time}\u00a0(МСК)`;
}

/**
 * The instant the window is judged against: the server's `Date` header when it
 * parses, the device clock otherwise. Managed clinic PCs often run minutes or
 * days off; the platform judges by its own clock, so a device that is behind
 * would show «откроется …» while the API already accepts sign-ups.
 */
export function serverNow(dateHeader: string | null, fallback: Date): Date {
  if (!dateHeader) return fallback;
  const ms = Date.parse(dateHeader);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}

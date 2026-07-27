/**
 * Every public route of the site (ТЗ §4 page map) — the single list the
 * responsive and a11y guards iterate. A new page must be added here, so it can
 * never ship without an overflow + axe check.
 */
export const ROUTES = [
  '/',
  '/program',
  '/participants',
  '/orgs',
  '/nmo',
  '/partners',
  '/contacts',
  '/faq',
  '/archive/',
  '/archive/2026',
  '/archive/2025',
  '/archive/2024',
  '/archive/2023',
  '/archive/2022',
  '/archive/2021',
] as const;

/** Archive year routes only — the data-driven year template. */
export const YEAR_ROUTES = ROUTES.filter((r) => /\/archive\/\d{4}$/.test(r));

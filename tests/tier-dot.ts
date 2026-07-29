/**
 * Tier → colour token for the `PartnerTier` marker (Issue #27), verbatim from
 * the `TIER_DOT` map of the Claude.design bundle
 * (`components/partners/PartnerTier.jsx`), where it is applied as an inline
 * style; this repo forbids inline `style=` and carries the map as per-tier
 * classes in components.css.
 *
 * The ramp DESCENDS: the parent brand's blues for the people who run the
 * congress, the congress accents for the paid tiers (sky → green → lime),
 * neutral for the two tiers below them.
 *
 * It lives OUTSIDE both suites because both need it and neither owns it: the
 * unit test pins the map against the authored CSS, the e2e suite asserts the
 * same pairs as painted pixels. Two copies would let one drift into agreeing
 * with a regression the other still catches.
 */
export const TIER_DOT = {
  organizer: '--ds-blue-dark',
  'co-organizer': '--ds-blue',
  strategic: '--ob-sky',
  general: '--ob-green',
  partner: '--ob-lime',
  exhibition: '--hairline',
  info: '--hairline',
} as const;

export type MarkedTier = keyof typeof TIER_DOT;

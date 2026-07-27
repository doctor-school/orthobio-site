/**
 * Derivations over congress content — pure functions, no rendering.
 *
 * Everything here is COMPUTED from the YAML (counts, grouping, ordinals); no
 * fact is introduced. Where a derived string mixes a number with a Russian word
 * («41 сессия»), the space is a literal U+00A0: these strings never pass through
 * the content schema, so the `prose()` typographer cannot reach them, and a
 * count must not be orphaned from its noun on a 360px screen.
 */

import type { CongressEntry, PartnerTier } from '@/content';
import { PARTNER_TIERS, PARTNER_TIER_LABELS } from '@/content';

type Congress = CongressEntry['data'];
/** One program session as the schema emits it. */
export type Session = NonNullable<Congress['program']>['sessions'][number];

const NBSP = ' ';

/** Non-breaking «<число> <слово>». */
export const nbsp = (value: number | string, word: string): string => `${value}${NBSP}${word}`;

/** Russian plural picker: [1, 2–4, 5+]. */
export const plural = (n: number, forms: readonly [string, string, string]): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
};

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/**
 * Congress ordinal as a Roman numeral («VII»). Content stores the ordinal as a
 * number (schema); the brand always prints it Roman.
 */
export const roman = (n: number): string => {
  let rest = n;
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
};

/** «VII конгресс» / «конгресс» when the ordinal was never verified. */
export const ordinalLabel = (number: number | null): string =>
  number === null ? 'конгресс' : `${roman(number)}${NBSP}конгресс`;

/** Partners of a year, grouped in the canonical tier order; empty tiers dropped. */
export const groupPartners = (
  partners: Congress['partners'],
): { tier: PartnerTier; label: string; items: Congress['partners'] }[] =>
  PARTNER_TIERS.map((tier) => ({
    tier,
    label: PARTNER_TIER_LABELS[tier],
    items: partners.filter((p) => p.tier === tier),
  })).filter((group) => group.items.length > 0);

/** Tiers rendered as prominent cards (design: major vs minor tier layout). */
export const MAJOR_TIERS: readonly PartnerTier[] = ['organizer', 'strategic', 'general'];

const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/**
 * Program sessions grouped by day, days ascending, undated sessions last under
 * an honest label. Session order inside a day is the content order.
 */
export const groupSessionsByDay = (
  sessions: readonly Session[],
): { key: string; label: string; sessions: Session[] }[] => {
  const days = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = session.date ? session.date.toISOString().slice(0, 10) : '';
    const bucket = days.get(key);
    if (bucket) bucket.push(session);
    else days.set(key, [session]);
  }
  const dated = [...days.entries()]
    .filter(([key]) => key !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const undated = days.get('');

  const groups = dated.map(([key, items], i) => ({
    key,
    label: `День ${i + 1} — ${dayFormatter.format(new Date(key))}`,
    sessions: items,
  }));
  if (undated) groups.push({ key: 'no-date', label: 'Дата сессии не указана', sessions: undated });
  return groups;
};

/**
 * Content highlights of a year, for the archive card tags. Every entry is a
 * COUNT of what the year file actually holds — an absent block yields no tag
 * (the card simply says less), never a fabricated one.
 */
export const yearHighlights = (c: Congress): string[] => {
  const tags: string[] = [];
  const sessions = c.program?.sessions ?? [];
  if (sessions.length > 0) {
    tags.push(nbsp(sessions.length, plural(sessions.length, ['сессия', 'сессии', 'сессий'])));
    const talks = sessions.reduce((sum, s) => sum + s.talks.length, 0);
    if (talks > 0) {
      tags.push(nbsp(talks, plural(talks, ['доклад', 'доклада', 'докладов'])));
    }
  }
  if (c.program?.pdf) tags.push('программа (PDF)');
  if (c.photos.length > 0) tags.push(nbsp('фото', String(c.photos.length)));
  if (c.videos.length > 0) tags.push(nbsp('видео', String(c.videos.length)));
  if (c.theses) tags.push('тезисы');
  if (c.partners.length > 0) {
    tags.push(nbsp(c.partners.length, plural(c.partners.length, ['партнёр', 'партнёра', 'партнёров'])));
  }
  return tags;
};

/** Video host label for the facade badge; the schema allows only these hosts. */
export const videoHost = (url: string): string => (/rutube\./.test(url) ? 'Rutube' : 'YouTube');

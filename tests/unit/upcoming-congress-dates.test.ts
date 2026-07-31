import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { UPCOMING_CONGRESS_DATES } from '../../src/config/site';

const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('confirmed 2027 congress dates', () => {
  it('exposes the exact display and machine-readable range', () => {
    expect(UPCOMING_CONGRESS_DATES.display).toBe('23–24 апреля 2027');
    expect(UPCOMING_CONGRESS_DATES.startDate).toBe('2027-04-23');
    expect(UPCOMING_CONGRESS_DATES.endDate).toBe('2027-04-24');

    const day = 24 * 60 * 60 * 1000;
    expect(
      Date.parse(UPCOMING_CONGRESS_DATES.endDate) -
        Date.parse(UPCOMING_CONGRESS_DATES.startDate),
    ).toBe(day);
  });

  it('keeps the home metadata and FAQ synchronized with the confirmed dates', () => {
    const canonical = UPCOMING_CONGRESS_DATES.display.replace('–', '-');
    const home = source('src/content/pages/home.yaml');
    const faq = source('src/content/pages/faq.yaml');
    const index = source('src/pages/index.astro');

    expect(home).toContain(canonical);
    expect(faq).toContain(canonical);
    expect(index).toContain('UPCOMING_CONGRESS_DATES.display');

    for (const body of [home, faq, index]) {
      expect(body).not.toMatch(/даты уточняются|точные даты.+не объявлены/i);
    }
  });
});

import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import directory from '../../src/data/settlements.json';
import {
  createSettlementIndex,
  expandDirectory,
  normalisePlace,
  settlementLabel,
  type SettlementDirectory,
} from '../../src/lib/settlements';

const SAMPLE: SettlementDirectory = {
  regions: ['г. Москва', 'Кемеровская область — Кузбасс', 'Ленинградская область', 'Московская область', 'Мурманская область'],
  places: [
    ['Москва', 0],
    ['Химки', 3],
    ['Королёв', 3],
    ['Кировск', 2],
    ['Кировск', 4],
    ['Кемерово', 1],
    ['Нахабино', 3],
  ],
};

const index = createSettlementIndex(expandDirectory(SAMPLE));
const match = (typed: string, allowPrefix = true) => index.match(typed, { allowPrefix });

describe('settlementLabel', () => {
  it('names the region after the place', () => {
    expect(settlementLabel('Химки', 'Московская область')).toBe('Химки — Московская область');
  });

  it('does not repeat a federal city as its own region', () => {
    expect(settlementLabel('Москва', 'г. Москва')).toBe('Москва');
  });
});

describe('normalisePlace', () => {
  it('ignores case, surrounding and repeated spaces, and ё/е', () => {
    expect(normalisePlace('  КОРОЛЁВ ')).toBe('королев');
    expect(normalisePlace('Красное   Село')).toBe('красное село');
  });

  it('strips a settlement-type prefix but not a leading letter of the name', () => {
    expect(normalisePlace('г. Химки')).toBe('химки');
    expect(normalisePlace('г.Химки')).toBe('химки');
    expect(normalisePlace('г Химки')).toBe('химки');
    expect(normalisePlace('город Химки')).toBe('химки');
    expect(normalisePlace('пгт Нахабино')).toBe('нахабино');
    expect(normalisePlace('Гатчина')).toBe('гатчина');
    expect(normalisePlace('Пушкин')).toBe('пушкин');
  });

  it('treats a comma or any dash between name and region alike, keeping hyphens inside names', () => {
    expect(normalisePlace('Химки, Московская область')).toBe(normalisePlace('Химки — Московская область'));
    expect(normalisePlace('Химки - Московская область')).toBe(normalisePlace('Химки — Московская область'));
    expect(normalisePlace('Ростов-на-Дону')).toBe('ростов-на-дону');
  });
});

describe('createSettlementIndex().match', () => {
  it('resolves the option label the datalist offers', () => {
    expect(match('Химки — Московская область')).toEqual({
      name: 'Химки',
      region: 'Московская область',
      label: 'Химки — Московская область',
    });
    expect(match('Кировск — Мурманская область')?.region).toBe('Мурманская область');
  });

  it('resolves a region name that itself contains a dash', () => {
    expect(match('Кемерово — Кемеровская область — Кузбасс')?.name).toBe('Кемерово');
  });

  it('resolves a bare name that is unique, whatever the case, ё and prefix', () => {
    expect(match('химки')?.region).toBe('Московская область');
    expect(match('г. Королев')?.name).toBe('Королёв');
    expect(match('москва')?.region).toBe('г. Москва');
  });

  it('refuses a bare name shared by several regions', () => {
    expect(match('Кировск')).toBeNull();
  });

  it('resolves a unique prefix of four letters or more, only when allowed', () => {
    expect(match('Нахаб')?.name).toBe('Нахабино');
    expect(match('Нахаб', false)).toBeNull();
    expect(match('Хим')).toBeNull();
    expect(match('Киров')).toBeNull();
  });

  it('returns nothing for empty or unknown text — the caller falls back to free text', () => {
    expect(match('   ')).toBeNull();
    expect(match('Минск')).toBeNull();
    expect(match('Химки, Тверская область')).toBeNull();
  });
});

describe('src/data/settlements.json', () => {
  const all = expandDirectory(directory as SettlementDirectory);
  const bundled = createSettlementIndex(all);

  it('covers the 89 federal subjects', () => {
    expect(directory.regions).toHaveLength(89);
    expect(new Set(all.map((s) => s.region)).size).toBe(89);
  });

  it('holds cities and urban-type settlements, with official region names', () => {
    expect(all.length).toBeGreaterThan(2500);
    expect(bundled.match('Химки')?.region).toBe('Московская область');
    expect(bundled.match('Казань')?.region).toBe('Республика Татарстан');
    expect(bundled.match('Москва')?.region).toBe('г. Москва');
    expect(bundled.match('Санкт-Петербург')?.region).toBe('г. Санкт-Петербург');
    expect(bundled.match('Сургут')?.region).toBe('Ханты-Мансийский автономный округ — Югра');
    expect(bundled.match('Нахабино')?.region).toBe('Московская область'); // рп
  });

  it('has no duplicate label', () => {
    expect(new Set(all.map((s) => s.label)).size).toBe(all.length);
  });

  it('stays small enough to ship to the browser', () => {
    const path = fileURLToPath(new URL('../../src/data/settlements.json', import.meta.url));
    expect(statSync(path).size).toBeLessThan(150 * 1024);
  });
});

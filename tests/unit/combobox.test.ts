import { describe, expect, it } from 'vitest';

import { filterOptions, foldCase, moveActive, splitHighlight } from '../../src/lib/combobox';

const SPECIALTIES = ['Травматология и ортопедия', 'Ортодонтия', 'Спортивная медицина', 'Детская хирургия'];
const byName = { text: (s: string) => s };

describe('foldCase', () => {
  it('folds case and ё without changing the length, so indices carry over', () => {
    const text = 'Ёлкино ПГТ';
    expect(foldCase(text)).toBe('елкино пгт');
    expect(foldCase(text)).toHaveLength(text.length);
  });
});

describe('filterOptions', () => {
  it('keeps every option, in order, for an empty query', () => {
    expect(filterOptions(SPECIALTIES, '  ', byName)).toEqual(SPECIALTIES);
  });

  it('keeps options containing the query and puts prefix matches first', () => {
    expect(filterOptions(SPECIALTIES, 'орто', byName)).toEqual(['Ортодонтия', 'Травматология и ортопедия']);
  });

  it('ignores case, ё and extra spacing in the query', () => {
    expect(filterOptions(['Щёлково', 'Щербинка'], '  ЩЕЛ ', byName)).toEqual(['Щёлково']);
    expect(filterOptions(SPECIALTIES, 'травматология   и', byName)).toEqual(['Травматология и ортопедия']);
  });

  it('keeps the source order inside each group (a stable sort)', () => {
    expect(filterOptions(['Бор', 'Борисоглебск', 'Выборг', 'Боровичи'], 'бор', byName)).toEqual([
      'Бор',
      'Борисоглебск',
      'Боровичи',
      'Выборг',
    ]);
  });

  it('caps the result at `limit`, after the prefix matches are ranked first', () => {
    expect(filterOptions(['Выборг', 'Бор', 'Борисоглебск'], 'бор', { ...byName, limit: 2 })).toEqual([
      'Бор',
      'Борисоглебск',
    ]);
  });

  it('matches through a caller-supplied normaliser', () => {
    // As the settlement field does: «г. » is a type prefix, not part of the name.
    const normalise = (q: string) => q.replace(/^г\.\s*/, '');
    expect(filterOptions(['Химки', 'Москва'], 'г. хим', { ...byName, normalise })).toEqual(['Химки']);
  });

  it('returns nothing when no option contains the query', () => {
    expect(filterOptions(SPECIALTIES, 'хирург-волшебник', byName)).toEqual([]);
  });
});

describe('splitHighlight', () => {
  it('splits the text around the first occurrence of the query, keeping the original letters', () => {
    expect(splitHighlight('Травматология и ортопедия', 'ОРТО')).toEqual({
      before: 'Травматология и ',
      match: 'орто',
      after: 'педия',
    });
  });

  it('matches across ё/е and keeps the ё the option spells', () => {
    expect(splitHighlight('Щёлково', 'щел')).toEqual({ before: '', match: 'Щёл', after: 'ково' });
  });

  it('collapses the query’s own spacing before looking', () => {
    expect(splitHighlight('Спортивная медицина', '  спорт  ')).toEqual({
      before: '',
      match: 'Спорт',
      after: 'ивная медицина',
    });
  });

  it('looks for what the caller-supplied normaliser leaves of the query', () => {
    const normalise = (q: string) => q.replace(/^г\.\s*/, '');
    expect(splitHighlight('Химки', 'г. хим', normalise)).toEqual({ before: '', match: 'Хим', after: 'ки' });
  });

  it('returns null for an empty or absent query', () => {
    expect(splitHighlight('Химки', '')).toBeNull();
    expect(splitHighlight('Химки', '   ')).toBeNull();
    expect(splitHighlight('Химки', 'тверь')).toBeNull();
  });
});

describe('moveActive', () => {
  it('steps down and up one option at a time', () => {
    expect(moveActive(0, 1, 5)).toBe(1);
    expect(moveActive(3, -1, 5)).toBe(2);
  });

  it('stops at both ends instead of wrapping', () => {
    expect(moveActive(4, 1, 5)).toBe(4);
    expect(moveActive(0, -1, 5)).toBe(0);
  });

  it('enters the list at its first option from «nothing active»', () => {
    expect(moveActive(-1, 1, 5)).toBe(0);
    expect(moveActive(-1, -1, 5)).toBe(0);
  });

  it('has no active option in an empty list', () => {
    expect(moveActive(0, 1, 0)).toBe(-1);
    expect(moveActive(-1, -1, 0)).toBe(-1);
  });

  it('pulls a stale index back inside a list that shrank', () => {
    expect(moveActive(9, 1, 3)).toBe(2);
  });
});

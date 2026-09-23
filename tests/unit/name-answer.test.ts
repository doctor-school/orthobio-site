import { describe, expect, it } from 'vitest';

import { normaliseNameAnswer } from '../../src/lib/name-answer';

/** Owner's rule and examples, Issue #78 comment of 2026-09-22 (044 EARS-33). */
describe('normaliseNameAnswer', () => {
  it.each([
    ['  иван ', 'Иван'],
    ['анна-мария', 'Анна-Мария'],
    ['ПЕТРОВ', 'Петров'],
    ['салтыков   щедрин', 'Салтыков Щедрин'],
    ["д'артаньян", "Д'Артаньян"],
  ])('%j → %j (owner example)', (typed, expected) => {
    expect(normaliseNameAnswer(typed)).toBe(expected);
  });

  it('collapses tabs and NBSP runs into one space', () => {
    expect(normaliseNameAnswer('\tмамин   сибиряк\t')).toBe('Мамин Сибиряк');
  });

  it('keeps the typographic apostrophe as a separator', () => {
    expect(normaliseNameAnswer('о’коннор')).toBe('О’Коннор');
  });

  it('treats ё like any other letter', () => {
    expect(normaliseNameAnswer('ёЛКИН')).toBe('Ёлкин');
    expect(normaliseNameAnswer('фёДОРОВ')).toBe('Фёдоров');
  });

  it('handles Latin the same way as Cyrillic', () => {
    expect(normaliseNameAnswer('JEAN-luc')).toBe('Jean-Luc');
  });

  it('is idempotent', () => {
    for (const typed of ['  иван ', 'анна-мария', "д'артаньян", 'салтыков   щедрин', 'ёлкин']) {
      const once = normaliseNameAnswer(typed);
      expect(normaliseNameAnswer(once)).toBe(once);
    }
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normaliseNameAnswer(' \t  ')).toBe('');
  });
});

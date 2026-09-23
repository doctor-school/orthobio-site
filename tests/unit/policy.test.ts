import { describe, expect, it } from 'vitest';

import { parsePolicy } from '../../src/lib/policy';

/**
 * `parsePolicy` infers structure for MARKUP only — the words must come out
 * unchanged, because the text's hash is the consent version (Issue #78).
 */
describe('parsePolicy', () => {
  it('takes the first non-empty line as the title', () => {
    const doc = parsePolicy('\n\n  Политика  \n\n1. Общие положения\n\nТекст.');
    expect(doc.title).toBe('Политика');
  });

  it('starts a section at a numbered top-level line and keeps other lines as paragraphs', () => {
    const doc = parsePolicy(
      [
        'Политика',
        '',
        '1. Общие положения',
        '',
        'Вводный абзац.',
        '1.1. Первый пункт;',
        '',
        '2. Основные понятия',
        '2.1. Второй пункт.',
      ].join('\n'),
    );
    expect(doc.sections).toEqual([
      { heading: '1. Общие положения', paragraphs: ['Вводный абзац.', '1.1. Первый пункт;'] },
      { heading: '2. Основные понятия', paragraphs: ['2.1. Второй пункт.'] },
    ]);
  });

  it('does not treat a numbered clause («1.1. …», «3.4 Город…») as a section heading', () => {
    const doc = parsePolicy('T\n\n3. Данные\n\n3.4 Город и место работы;\n3.5. Специальность.');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].paragraphs).toEqual([
      '3.4 Город и место работы;',
      '3.5. Специальность.',
    ]);
  });

  it('keeps a preamble before the first heading as a heading-less section', () => {
    const doc = parsePolicy('T\n\nПреамбула.\n\n1. Раздел\nТекст.');
    expect(doc.sections).toEqual([
      { heading: null, paragraphs: ['Преамбула.'] },
      { heading: '1. Раздел', paragraphs: ['Текст.'] },
    ]);
  });

  it('ignores empty and whitespace-only lines and tolerates CRLF', () => {
    const doc = parsePolicy('T\r\n\r\n   \r\n1. Раздел\r\n\r\nТекст.\r\n');
    expect(doc).toEqual({
      title: 'T',
      sections: [{ heading: '1. Раздел', paragraphs: ['Текст.'] }],
    });
  });

  it('returns an empty document for empty input', () => {
    expect(parsePolicy('')).toEqual({ title: '', sections: [] });
  });

  it('preserves the words of every line — only surrounding whitespace is dropped', () => {
    const line = '1.2. Настоящая политика «О персональных данных» – https://orthobio.ru.';
    const doc = parsePolicy(`T\n1. Раздел\n  ${line}`);
    expect(doc.sections[0].paragraphs).toEqual([line]);
  });
});

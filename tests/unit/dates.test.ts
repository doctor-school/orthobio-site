import { describe, expect, it } from 'vitest';

import {
  fillContentTokens,
  fillContentTokensDeep,
  formatMoscowDateRange,
  instantFromEnv,
} from '../../src/lib/dates';

const NB = '\u00a0';

describe('formatMoscowDateRange', () => {
  it('writes a same-year range with the year once, in the genitive', () => {
    expect(formatMoscowDateRange('2026-10-01T00:00:00+03:00', '2026-12-01T23:59:59+03:00')).toBe(
      `с${NB}1${NB}октября по${NB}1${NB}декабря 2026${NB}года`,
    );
  });

  it('writes both years when the range crosses a year', () => {
    expect(formatMoscowDateRange('2026-12-15T00:00:00+03:00', '2027-02-01T23:59:59+03:00')).toBe(
      `с${NB}15${NB}декабря 2026${NB}года по${NB}1${NB}февраля 2027${NB}года`,
    );
  });

  it('prints the Moscow calendar day, not the UTC one', () => {
    // 21:30 UTC on 30 November is already 1 December in Moscow.
    expect(formatMoscowDateRange('2026-09-30T21:30:00Z', '2026-11-30T21:30:00Z')).toBe(
      `с${NB}1${NB}октября по${NB}1${NB}декабря 2026${NB}года`,
    );
  });

  it('refuses a range that closes before it opens', () => {
    expect(() =>
      formatMoscowDateRange('2026-12-01T00:00:00+03:00', '2026-10-01T00:00:00+03:00'),
    ).toThrow(/before/);
  });

  it('throws on an unparseable instant', () => {
    expect(() => formatMoscowDateRange('скоро', '2026-12-01T00:00:00+03:00')).toThrow(
      /unparseable/,
    );
  });
});

describe('instantFromEnv', () => {
  const FALLBACK = '2027-04-22T00:00:00+03:00';

  it('falls back when the variable is unset or blank', () => {
    // A GitHub Variable that does not exist reaches the build as ''.
    expect(instantFromEnv('X', undefined, FALLBACK)).toBe(FALLBACK);
    expect(instantFromEnv('X', '', FALLBACK)).toBe(FALLBACK);
    expect(instantFromEnv('X', '   ', FALLBACK)).toBe(FALLBACK);
  });

  it('takes an override with an explicit offset, trimmed', () => {
    expect(instantFromEnv('X', ' 2027-04-21T00:00:00.000+03:00 ', FALLBACK)).toBe(
      '2027-04-21T00:00:00.000+03:00',
    );
    expect(instantFromEnv('X', '2027-04-20T21:00:00Z', FALLBACK)).toBe('2027-04-20T21:00:00Z');
  });

  it('fails the build on a bare date or a zone-less time, naming the variable', () => {
    // A bare date would be read as UTC midnight — 03:00 in Moscow.
    expect(() => instantFromEnv('CONGRESS_X', '2027-04-22', FALLBACK)).toThrow(/CONGRESS_X/);
    expect(() => instantFromEnv('CONGRESS_X', '2027-04-22T00:00:00', FALLBACK)).toThrow(
      /CONGRESS_X/,
    );
    expect(() => instantFromEnv('CONGRESS_X', '2027-13-45T00:00:00+03:00', FALLBACK)).toThrow(
      /CONGRESS_X/,
    );
  });
});

describe('fillContentTokens', () => {
  const TOKENS = { submissionWindow: 'с 1 октября по 1 декабря 2026 года' };

  it('substitutes a known token', () => {
    expect(fillContentTokens('Материалы принимаются {{submissionWindow}}.', TOKENS)).toBe(
      'Материалы принимаются с 1 октября по 1 декабря 2026 года.',
    );
  });

  it('tolerates inner spaces and repeats', () => {
    expect(fillContentTokens('{{ submissionWindow }} / {{submissionWindow}}', TOKENS)).toBe(
      `${TOKENS.submissionWindow} / ${TOKENS.submissionWindow}`,
    );
  });

  it('leaves text without tokens untouched', () => {
    expect(fillContentTokens('Конгресс 2026 года, {фигурные} скобки', TOKENS)).toBe(
      'Конгресс 2026 года, {фигурные} скобки',
    );
  });

  it('fails loudly on an unknown token instead of publishing it', () => {
    expect(() => fillContentTokens('до {{submissionDeadline}}', TOKENS)).toThrow(
      /submissionDeadline/,
    );
  });
});

describe('fillContentTokensDeep', () => {
  const TOKENS = { submissionWindow: 'с 1 по 2' };

  it('fills strings at any depth and keeps every other value as it is', () => {
    const data = {
      title: 'Участникам',
      description: 'Приём {{submissionWindow}}.',
      overline: null,
      lead: ['a', '{{submissionWindow}}'],
      blocks: [{ kind: 'faq', items: [{ q: 'Когда?', a: 'Приём {{submissionWindow}}.' }] }],
      stats: [{ value: '6', n: 6, on: true }],
    };
    expect(fillContentTokensDeep(data, TOKENS)).toEqual({
      ...data,
      description: 'Приём с 1 по 2.',
      lead: ['a', 'с 1 по 2'],
      blocks: [{ kind: 'faq', items: [{ q: 'Когда?', a: 'Приём с 1 по 2.' }] }],
    });
  });

  it('does not mutate its input', () => {
    const data = { lead: ['{{submissionWindow}}'] };
    fillContentTokensDeep(data, TOKENS);
    expect(data.lead[0]).toBe('{{submissionWindow}}');
  });

  it('fails loudly on an unknown token anywhere in the tree', () => {
    expect(() => fillContentTokensDeep({ a: [{ b: '{{nope}}' }] }, TOKENS)).toThrow(/nope/);
  });
});

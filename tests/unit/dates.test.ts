import { describe, expect, it } from 'vitest';

import {
  fillContentTokens,
  fillContentTokensDeep,
  instantFromEnv,
} from '../../src/lib/dates';

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
  const TOKENS = { oralTalkDeadline: '15 января 2027 года' };

  it('substitutes a known token', () => {
    expect(fillContentTokens('Устные доклады — до {{oralTalkDeadline}}.', TOKENS)).toBe(
      'Устные доклады — до 15 января 2027 года.',
    );
  });

  it('tolerates inner spaces and repeats', () => {
    expect(fillContentTokens('{{ oralTalkDeadline }} / {{oralTalkDeadline}}', TOKENS)).toBe(
      `${TOKENS.oralTalkDeadline} / ${TOKENS.oralTalkDeadline}`,
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
  const TOKENS = { oralTalkDeadline: '15 января' };

  it('fills strings at any depth and keeps every other value as it is', () => {
    const data = {
      title: 'Участникам',
      description: 'До {{oralTalkDeadline}}.',
      overline: null,
      lead: ['a', '{{oralTalkDeadline}}'],
      blocks: [{ kind: 'faq', items: [{ q: 'Когда?', a: 'До {{oralTalkDeadline}}.' }] }],
      stats: [{ value: '6', n: 6, on: true }],
    };
    expect(fillContentTokensDeep(data, TOKENS)).toEqual({
      ...data,
      description: 'До 15 января.',
      lead: ['a', '15 января'],
      blocks: [{ kind: 'faq', items: [{ q: 'Когда?', a: 'До 15 января.' }] }],
    });
  });

  it('does not mutate its input', () => {
    const data = { lead: ['{{oralTalkDeadline}}'] };
    fillContentTokensDeep(data, TOKENS);
    expect(data.lead[0]).toBe('{{oralTalkDeadline}}');
  });

  it('fails loudly on an unknown token anywhere in the tree', () => {
    expect(() => fillContentTokensDeep({ a: [{ b: '{{nope}}' }] }, TOKENS)).toThrow(/nope/);
  });
});

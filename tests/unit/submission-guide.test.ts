import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  CONTENT_TOKENS,
  POSTER_AGE_CUTOFF,
  POSTER_AGE_LIMIT_YEARS,
  SUBMISSION_DEADLINES,
  UPCOMING_CONGRESS_DATES,
} from '@/config/site';
import { pageSchemaChecked, type SubmissionGuideBlock } from '@/content/schemas';
import { fillContentTokensDeep, formatDotted, formatRuDay, youngerThanCutoff } from '@/lib/dates';
import { SUBMISSION_GUIDE_ANCHOR, SUBMISSION_GUIDE_HREF, submissionStepId } from '@/lib/submission-guide';

/**
 * «Как подать материалы» on /participants (Issue #99) — values, not geometry.
 * A wrong date, a missing step or a screenshot that is not in the bucket is
 * valid DOM that passes the overflow and axe sweeps alike.
 */

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8');
const NB = ' ';
const plain = (s: string) => s.replaceAll(NB, ' ');

const raw = parse(read('src/content/pages/participants.yaml')) as Record<string, unknown>;
const participants = pageSchemaChecked.parse(raw);
const isGuide = (b: { kind: string }): b is SubmissionGuideBlock => b.kind === 'submission-guide';
const guide = participants.blocks.find(isGuide)!;
// What the page prints: getPage() fills the tokens after the schema.
const filled = fillContentTokensDeep(guide, CONTENT_TOKENS);

describe('date helpers', () => {
  it('prints a day the way Typograf typesets it in running text', () => {
    expect(formatRuDay('2027-04-23')).toBe(`23${NB}апреля 2027`);
    expect(formatRuDay('2027-01-05')).toBe(`5${NB}января 2027`);
  });

  it('prints a date of birth as the form field shows it', () => {
    expect(formatDotted('1987-04-24')).toBe('24.04.1987');
    expect(formatDotted('1990-12-01')).toBe('01.12.1990');
  });

  it('refuses a day that is not on the calendar', () => {
    expect(() => formatRuDay('2027-02-30')).toThrow(/calendar date/);
    expect(() => formatDotted('23.04.2027')).toThrow(/calendar date/);
  });

  it('draws the «younger than N on the day» line on the Nth birthday', () => {
    // Born exactly 40 years before turns 40 that day — not younger than 40.
    expect(youngerThanCutoff('2027-04-23', 40)).toEqual({
      bornFrom: '1987-04-24',
      bornUntil: '1987-04-23',
    });
  });

  it('crosses month and year boundaries', () => {
    expect(youngerThanCutoff('2027-04-30', 40)).toEqual({ bornFrom: '1987-05-01', bornUntil: '1987-04-30' });
    expect(youngerThanCutoff('2027-12-31', 40)).toEqual({ bornFrom: '1988-01-01', bornUntil: '1987-12-31' });
  });

  it('treats a 29 February with no twin N years back as 28 February', () => {
    expect(youngerThanCutoff('2028-02-29', 41)).toEqual({ bornFrom: '1987-03-01', bornUntil: '1987-02-28' });
    expect(youngerThanCutoff('2028-02-29', 40)).toEqual({ bornFrom: '1988-03-01', bornUntil: '1988-02-29' });
  });

  it('refuses a nonsensical age limit', () => {
    expect(() => youngerThanCutoff('2027-04-23', 0)).toThrow(/positive integer/);
    expect(() => youngerThanCutoff('2027-04-23', 39.5)).toThrow(/positive integer/);
  });
});

describe('poster age cutoff in the config', () => {
  it('is 40 years on the first congress day', () => {
    expect(POSTER_AGE_LIMIT_YEARS).toBe(40);
    expect(UPCOMING_CONGRESS_DATES.startDate).toBe('2027-04-23');
    expect(POSTER_AGE_CUTOFF).toEqual({ bornFrom: '1987-04-24', bornUntil: '1987-04-23' });
  });

  it('reaches copy only through tokens', () => {
    expect(CONTENT_TOKENS.congressStartDay).toBe(formatRuDay(UPCOMING_CONGRESS_DATES.startDate));
    expect(CONTENT_TOKENS.posterBornFrom).toBe(formatDotted(POSTER_AGE_CUTOFF.bornFrom));
    expect(CONTENT_TOKENS.posterBornUntil).toBe(formatDotted(POSTER_AGE_CUTOFF.bornUntil));
  });
});

describe('participants.yaml → submission guide', () => {
  it('lives at the permanent anchor #podat-materialy', () => {
    expect(SUBMISSION_GUIDE_ANCHOR).toBe('podat-materialy');
    expect(SUBMISSION_GUIDE_HREF).toBe('/participants#podat-materialy');
    expect(submissionStepId(2)).toBe('podat-materialy-2');
  });

  it('sits with the submission blocks, before «Проживание»', () => {
    const kinds = participants.blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === 'submission-guide')).toHaveLength(1);
    expect(kinds.indexOf('submission-guide')).toBe(kinds.indexOf('accommodation') - 1);
  });

  it('keeps the approved heading and the ten approved steps, in order', () => {
    expect(plain(guide.heading)).toBe('Как подать материалы на VIII Конгресс «Ортобиология 2027»');
    expect(guide.steps.map((s) => plain(s.title))).toEqual([
      'Кто может подать материалы',
      'Как войти в кабинет',
      'Кабинет «Мои заявки на Конгресс»',
      'Устный доклад',
      'Постерный доклад',
      'Тезисы',
      'Согласие на обработку персональных данных',
      'Сроки',
      'После отправки',
      'Частые вопросы',
    ]);
  });

  it('leaves «Как войти в кабинет» empty until the sign-in rework', () => {
    const step = guide.steps[1];
    expect(step.text).toBeNull();
    expect(step.links).toEqual([]);
    expect(step.shots).toEqual([]);
  });

  it('writes every date as a token — none is spelled out in the copy', () => {
    const steps = (raw.blocks as { kind: string; steps?: { text: string | null }[] }[]).find(
      (b) => b.kind === 'submission-guide',
    )!.steps!;
    const copy = steps.map((s) => s.text ?? '').join('\n');
    for (const token of [
      '{{oralTalkDeadline}}',
      '{{posterAbstractDeadline}}',
      '{{congressStartDay}}',
      '{{posterBornFrom}}',
      '{{posterBornUntil}}',
    ]) {
      expect(copy).toContain(token);
    }
    expect(copy).not.toMatch(/\d{1,2}\.\d{2}\.\d{4}/);
    expect(copy).not.toMatch(/\d{1,2}\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*/i);
  });

  it('prints the config dates where the tokens stood', () => {
    const text = (n: number) => plain(filled.steps[n - 1].text ?? '');
    const oral = plain(SUBMISSION_DEADLINES.oralTalk.display);
    const poster = plain(SUBMISSION_DEADLINES.posterAbstract.display);
    expect(text(1)).toContain(`устные доклады — до ${oral}, постерные доклады и тезисы — до ${poster}, до 23:59`);
    expect(text(8)).toContain(`устный доклад — ${oral}; постерный доклад и тезисы — ${poster}.`);
    expect(text(5)).toContain(
      'младше 40 лет на 23 апреля 2027: родились 24.04.1987 или позже — можно; 23.04.1987 или раньше — нельзя',
    );
    expect(JSON.stringify(filled)).not.toContain('{{');
  });

  it('links «Зарегистрироваться» to the on-site registration form', () => {
    expect(guide.steps[0].links).toEqual([{ text: '«Зарегистрироваться»', href: '/registration' }]);
  });

  it('places the eleven cabinet screenshots, each once, from our bucket', () => {
    const shots = guide.steps.flatMap((s) => s.shots);
    expect(shots).toHaveLength(11);
    expect(new Set(shots.map((s) => s.url)).size).toBe(11);
    const listed = new Set(
      read('docs/assets-checksums.txt')
        .split(/\r?\n/)
        .map((line) => line.split('  ')[1]),
    );
    for (const shot of shots) {
      expect(shot.url).toMatch(/^\/media\/2027\/submissions\/\d{2}-[a-z-]+\.png$/);
      expect(listed.has(shot.url.replace('/media/', '')), `${shot.url} is not in the checksum list`).toBe(true);
      expect(shot.alt.length, `${shot.url} needs a meaningful alt`).toBeGreaterThan(40);
    }
  });

  it('shows each screenshot under the step it illustrates', () => {
    const where = Object.fromEntries(
      guide.steps.flatMap((s, i) => s.shots.map((shot) => [shot.url.split('/').at(-1)!.slice(0, 2), i + 1])),
    );
    expect(where).toEqual({
      '01': 3,
      '11': 3,
      '03': 4,
      '04': 4,
      '05': 4,
      '07': 4,
      '08': 5,
      '09': 5,
      '10': 6,
      '06': 7,
      '12': 9,
    });
  });
});

describe('schema guards of the guide', () => {
  const page = (blocks: unknown[]) => ({ title: 'T', blocks });
  const step = (over: Record<string, unknown> = {}) => ({ title: 'Шаг', text: 'Текст шага.', ...over });
  const block = (steps: unknown[]) => ({ kind: 'submission-guide', heading: 'H', steps });

  it('fails the build when a step stops containing its link phrase', () => {
    const r = pageSchemaChecked.safeParse(
      page([block([step({ links: [{ text: '«Зарегистрироваться»', href: '/registration' }] })])]),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must contain');
  });

  it('refuses an off-site link', () => {
    const r = pageSchemaChecked.safeParse(
      page([block([step({ text: 'Перейти сюда.', links: [{ text: 'сюда', href: 'https://example.com/' }] })])]),
    );
    expect(r.success).toBe(false);
  });

  it('refuses links or screenshots on a step without text', () => {
    const shot = { url: '/media/2027/submissions/x.png', alt: 'a', width: 1, height: 1 };
    const r = pageSchemaChecked.safeParse(page([block([step({ text: null, shots: [shot] })])]));
    expect(r.success).toBe(false);
  });

  it('allows one guide per page — its anchor is fixed', () => {
    const r = pageSchemaChecked.safeParse(page([block([step()]), block([step()])]));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('at most one submission-guide');
  });

  it('refuses a screenshot hosted anywhere but our storage', () => {
    const shot = { url: 'https://example.com/x.png', alt: 'a', width: 1, height: 1 };
    expect(pageSchemaChecked.safeParse(page([block([step({ shots: [shot] })])])).success).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  CABINET_LOGIN_LABEL,
  CABINET_LOGIN_URL,
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

  it('walks «Как войти в кабинет» as five numbered sub-steps, a button and a note', () => {
    const step = guide.steps[1];
    expect(step.text).toBeNull();
    expect(step.items).toHaveLength(5);
    expect(step.cta).toBe('cabinet-login');
    expect(step.note).not.toBeNull();
    // The button the first sub-step tells the reader to press is the one printed.
    expect(plain(step.items[0].text)).toContain(`«${CABINET_LOGIN_LABEL}»`);
    // The screenshots follow «Отправить код» (3) and the code letter (4).
    expect(step.items.map((item) => item.shots.length)).toEqual([0, 0, 1, 2, 0]);
  });

  it('sends «Войти в кабинет» to the Doctor.School sign-in by code, back to the congress cabinet', () => {
    const url = new URL(CABINET_LOGIN_URL);
    expect(url.origin).toBe('https://new.doctor.school');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('method')).toBe('code');
    expect(url.searchParams.get('returnTo')).toBe('/account/congress');
    // tests/e2e/submission-guide.spec.ts holds the rendered href to this literal.
    expect(CABINET_LOGIN_URL).toBe('https://new.doctor.school/login?method=code&returnTo=/account/congress');
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
    // The take-back deadline is dated, as the cabinet now states it
    // (ds-platform #2573) — never «пока приём открыт».
    const takeBack = `устные доклады — до ${oral}, постерные доклады и тезисы — до ${poster}`;
    expect(text(9)).toContain(`можно «Забрать на исправление» до окончания приёма своего вида: ${takeBack};`);
    expect(text(10)).toContain(`пока заявка «Отправлена», до окончания приёма своего вида (${takeBack}): «Забрать на исправление»`);
    expect(filled.steps.map((s) => plain(s.text ?? '')).join('\n')).not.toMatch(/приём открыт|открыт приём/);
    expect(JSON.stringify(filled)).not.toContain('{{');
  });

  it('links «Зарегистрироваться» to the on-site registration form', () => {
    expect(guide.steps[0].links).toEqual([{ text: '«Зарегистрироваться»', href: '/registration' }]);
  });

  it('places the fourteen screenshots, each once, from our bucket', () => {
    const shots = guide.steps.flatMap((s) => [...s.items.flatMap((item) => item.shots), ...s.shots]);
    expect(shots).toHaveLength(14);
    expect(new Set(shots.map((s) => s.url)).size).toBe(14);
    const listed = new Set(
      read('docs/assets-checksums.txt')
        .split(/\r?\n/)
        .map((line) => line.split('  ')[1]),
    );
    for (const shot of shots) {
      expect(shot.url).toMatch(/^\/media\/2027\/submissions\/((login-)?\d{2}-[a-z0-9-]+|letter-code)\.png$/);
      expect(listed.has(shot.url.replace('/media/', '')), `${shot.url} is not in the checksum list`).toBe(true);
      expect(shot.alt.length, `${shot.url} needs a meaningful alt`).toBeGreaterThan(40);
    }
  });

  it('shows each screenshot under the step it illustrates', () => {
    const file = (url: string) => url.split('/').at(-1)!;
    const where = Object.fromEntries(
      guide.steps.flatMap((s, i) => [
        ...s.items.flatMap((item, j) => item.shots.map((shot) => [file(shot.url), `${i + 1}.${j + 1}`])),
        ...s.shots.map((shot) => [file(shot.url), `${i + 1}`]),
      ]),
    );
    expect(where).toEqual({
      'login-02-by-code-email.png': '2.3',
      'login-03-check-email.png': '2.4',
      'letter-code.png': '2.4',
      '01-cabinet-empty.png': '3',
      '11-list-with-statuses-v2.png': '3',
      '03-oral-form-authors.png': '4',
      '04-oral-form-text.png': '4',
      '05-validation-errors.png': '4',
      '07-submit-confirm-v2.png': '4',
      '08-poster-birthdate.png': '5',
      '09-poster-age-refusal.png': '5',
      '10-abstract-form.png': '6',
      '06-consent-and-submit.png': '7',
      '12-sent-card-actions-v2.png': '9',
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

  it('refuses screenshots, a button or a note on a heading-only step', () => {
    const shot = { url: '/media/2027/submissions/x.png', alt: 'a', width: 1, height: 1 };
    for (const extra of [{ shots: [shot] }, { cta: 'cabinet-login' }, { note: { lead: 'Л.', text: 'Т.' } }]) {
      expect(pageSchemaChecked.safeParse(page([block([step({ text: null, ...extra })])])).success).toBe(false);
    }
  });

  it('allows a step of sub-steps only, with a button and a note', () => {
    const r = pageSchemaChecked.safeParse(
      page([block([step({ text: null, items: [{ text: 'Один.' }], cta: 'cabinet-login', note: { lead: 'Л.', text: 'Т.' } })])]),
    );
    expect(r.success).toBe(true);
  });

  it('refuses a button the config does not define', () => {
    expect(pageSchemaChecked.safeParse(page([block([step({ cta: 'elsewhere' })])])).success).toBe(false);
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

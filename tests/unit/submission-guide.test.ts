import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  CABINET_LOGIN_LABEL,
  CABINET_LOGIN_URL,
  CONTENT_TOKENS,
  FILL_GUIDE_URL,
  POSTER_AGE_CUTOFF,
  POSTER_AGE_LIMIT_YEARS,
  SUBMISSION_DEADLINES,
  UPCOMING_CONGRESS_DATES,
} from '@/config/site';
import { pageSchemaChecked, type SubmissionGuideBlock } from '@/content/schemas';
import { fillContentTokensDeep, formatDotted, formatRuDay, youngerThanCutoff } from '@/lib/dates';
import {
  FILL_GUIDE_ANCHOR,
  guideStepId,
  SUBMISSION_GUIDE_ANCHOR,
  SUBMISSION_GUIDE_HREF,
  submissionStepId,
} from '@/lib/submission-guide';

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
const guides = participants.blocks.filter(isGuide);
const guide = guides.find((b) => b.anchor === SUBMISSION_GUIDE_ANCHOR)!;
const fill = guides.find((b) => b.anchor === FILL_GUIDE_ANCHOR)!;
// What the page prints: getPage() fills the tokens after the schema.
const filled = fillContentTokensDeep(guide, CONTENT_TOKENS);
const filledFill = fillContentTokensDeep(fill, CONTENT_TOKENS);

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
  it('lives at the permanent anchors #podat-materialy and #zapolnit-zayavku', () => {
    expect(SUBMISSION_GUIDE_ANCHOR).toBe('podat-materialy');
    expect(SUBMISSION_GUIDE_HREF).toBe('/participants#podat-materialy');
    expect(submissionStepId(2)).toBe('podat-materialy-2');
    expect(FILL_GUIDE_ANCHOR).toBe('zapolnit-zayavku');
    expect(FILL_GUIDE_URL).toBe(`/participants#${FILL_GUIDE_ANCHOR}`);
    expect(guideStepId(FILL_GUIDE_ANCHOR, 8)).toBe('zapolnit-zayavku-8');
  });

  it('sits with the submission blocks: sign-in, then filling in, then «Проживание»', () => {
    const order = participants.blocks.map((b) => (isGuide(b) ? b.anchor : b.kind));
    const at = order.indexOf('accommodation');
    expect(order.slice(at - 2, at + 1)).toEqual([SUBMISSION_GUIDE_ANCHOR, FILL_GUIDE_ANCHOR, 'accommodation']);
    expect(guides).toHaveLength(2);
  });

  it('keeps the approved heading and its two steps, then points on to «Как заполнить заявку»', () => {
    expect(plain(guide.heading)).toBe('Как подать материалы на VIII Конгресс «Ортобиология 2027»');
    expect(guide.steps.map((s) => plain(s.title))).toEqual(['Кто может подать материалы', 'Как войти в кабинет']);
    expect(guide.next?.anchor).toBe(FILL_GUIDE_ANCHOR);
    expect(plain(guide.next?.text ?? '')).toBe('Дальше — как заполнить заявку');
  });

  it('keeps the eight cabinet steps of the approved text, in order, under «Как заполнить заявку»', () => {
    expect(plain(fill.heading)).toBe('Как заполнить заявку');
    expect(fill.next).toBeNull();
    expect(fill.steps.map((s) => plain(s.title))).toEqual([
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

  it('shows no sign-in in «Как заполнить заявку» — a reader there is already signed in', () => {
    const text = JSON.stringify(filledFill);
    expect(fill.steps.flatMap((s) => s.items.map((item) => item.cta))).toEqual([]);
    expect(text).not.toContain(CABINET_LOGIN_LABEL);
    expect(text).not.toMatch(/Отправить код|код для входа|войти|вход[ау]?[^а-яё]/i);
    // «Тезисы» points at «Согласие» by its new number.
    expect(plain(fill.steps[3].text ?? '')).toContain('покрывает согласие (раздел 5).');
    expect(plain(fill.steps[4].title)).toBe('Согласие на обработку персональных данных');
  });

  it('walks «Как войти в кабинет» as five numbered sub-steps, the button under the first, and a note', () => {
    const step = guide.steps[1];
    expect(step.text).toBeNull();
    expect(step.items).toHaveLength(5);
    // The button sits under the sub-step that tells the reader to press it.
    expect(step.items.map((item) => item.cta)).toEqual(['cabinet-login', null, null, null, null]);
    expect(step.note).not.toBeNull();
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
    const steps = (raw.blocks as { kind: string; steps?: { text: string | null }[] }[])
      .filter((b) => b.kind === 'submission-guide')
      .flatMap((b) => b.steps!);
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
    // Steps 1–2 are «Как подать материалы», 3–10 the eight of «Как заполнить заявку».
    const all = [...filled.steps, ...filledFill.steps];
    const text = (n: number) => plain(all[n - 1].text ?? '');
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
    expect(all.map((s) => plain(s.text ?? '')).join('\n')).not.toMatch(/приём открыт|открыт приём/);
    expect(JSON.stringify([filled, filledFill])).not.toContain('{{');
  });

  it('links «Зарегистрироваться» to the on-site registration form', () => {
    expect(guide.steps[0].links).toEqual([{ text: '«Зарегистрироваться»', href: '/registration' }]);
  });

  it('places the fourteen screenshots, each once, from our bucket', () => {
    const shots = guides
      .flatMap((g) => g.steps)
      .flatMap((s) => [...s.items.flatMap((item) => item.shots), ...s.shots]);
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
      guides.flatMap((g) =>
        g.steps.flatMap((s, i) => [
          ...s.items.flatMap((item, j) => item.shots.map((shot) => [file(shot.url), `${g.anchor}-${i + 1}.${j + 1}`])),
          ...s.shots.map((shot) => [file(shot.url), `${g.anchor}-${i + 1}`]),
        ]),
      ),
    );
    expect(where).toEqual({
      'login-02-by-code-email.png': 'podat-materialy-2.3',
      'login-03-check-email.png': 'podat-materialy-2.4',
      'letter-code.png': 'podat-materialy-2.4',
      '01-cabinet-empty.png': 'zapolnit-zayavku-1',
      '11-list-with-statuses-v2.png': 'zapolnit-zayavku-1',
      '03-oral-form-authors.png': 'zapolnit-zayavku-2',
      '04-oral-form-text.png': 'zapolnit-zayavku-2',
      '05-validation-errors.png': 'zapolnit-zayavku-2',
      '07-submit-confirm-v2.png': 'zapolnit-zayavku-2',
      '08-poster-birthdate.png': 'zapolnit-zayavku-3',
      '09-poster-age-refusal.png': 'zapolnit-zayavku-3',
      '10-abstract-form.png': 'zapolnit-zayavku-4',
      '06-consent-and-submit.png': 'zapolnit-zayavku-5',
      '12-sent-card-actions-v2.png': 'zapolnit-zayavku-7',
    });
  });
});

describe('schema guards of the guide', () => {
  const page = (blocks: unknown[]) => ({ title: 'T', blocks });
  const step = (over: Record<string, unknown> = {}) => ({ title: 'Шаг', text: 'Текст шага.', ...over });
  const block = (steps: unknown[], over: Record<string, unknown> = {}) => ({
    kind: 'submission-guide',
    anchor: 'podat-materialy',
    heading: 'H',
    steps,
    ...over,
  });

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

  it('refuses screenshots or a note on a heading-only step', () => {
    const shot = { url: '/media/2027/submissions/x.png', alt: 'a', width: 1, height: 1 };
    for (const extra of [{ shots: [shot] }, { note: { lead: 'Л.', text: 'Т.' } }]) {
      expect(pageSchemaChecked.safeParse(page([block([step({ text: null, ...extra })])])).success).toBe(false);
    }
  });

  it('allows a step of sub-steps only, with a button under a sub-step and a note', () => {
    const items = [{ text: 'Один.', cta: 'cabinet-login' }];
    const r = pageSchemaChecked.safeParse(page([block([step({ text: null, items, note: { lead: 'Л.', text: 'Т.' } })])]));
    expect(r.success).toBe(true);
  });

  it('refuses a button the config does not define', () => {
    const items = [{ text: 'Один.', cta: 'elsewhere' }];
    expect(pageSchemaChecked.safeParse(page([block([step({ text: null, items })])])).success).toBe(false);
  });

  it('allows one guide per anchor — the anchors are fixed', () => {
    const r = pageSchemaChecked.safeParse(page([block([step()]), block([step()])]));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('at most one submission-guide block per anchor');
    const two = page([block([step()]), block([step()], { anchor: 'zapolnit-zayavku' })]);
    expect(pageSchemaChecked.safeParse(two).success).toBe(true);
  });

  it('refuses an anchor that is not one of the fixed ones', () => {
    expect(pageSchemaChecked.safeParse(page([block([step()], { anchor: 'elsewhere' })])).success).toBe(false);
  });

  it('points a guide only at another guide of the page', () => {
    const next = { text: 'Дальше', anchor: 'zapolnit-zayavku' };
    expect(pageSchemaChecked.safeParse(page([block([step()], { next })])).success).toBe(false);
    const self = { ...next, anchor: 'podat-materialy' };
    expect(pageSchemaChecked.safeParse(page([block([step()], { next: self })])).success).toBe(false);
    const ok = page([block([step()], { next }), block([step()], { anchor: 'zapolnit-zayavku' })]);
    expect(pageSchemaChecked.safeParse(ok).success).toBe(true);
  });

  it('refuses a screenshot hosted anywhere but our storage', () => {
    const shot = { url: 'https://example.com/x.png', alt: 'a', width: 1, height: 1 };
    expect(pageSchemaChecked.safeParse(page([block([step({ shots: [shot] })])])).success).toBe(false);
  });
});

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
import { STATIC_PUBLIC_ROUTES } from '@/lib/seo';
import {
  FILL_GUIDE_ANCHOR,
  guideInline,
  FILL_GUIDE_PATH,
  FILL_GUIDE_REDIRECT_SCRIPT,
  guideStepId,
  SUBMISSION_GUIDE_ANCHOR,
  SUBMISSION_GUIDE_HREF,
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
// «Как заполнить заявку» is its own page (owner, 2026-10-07): one task per page.
const rawFill = parse(read('src/content/pages/zapolnit-zayavku.yaml')) as Record<string, unknown>;
const fillPage = pageSchemaChecked.parse(rawFill);
const isGuide = (b: { kind: string }): b is SubmissionGuideBlock => b.kind === 'submission-guide';
const guide = participants.blocks.filter(isGuide).find((b) => b.anchor === SUBMISSION_GUIDE_ANCHOR)!;
const fill = fillPage.blocks.filter(isGuide).find((b) => b.anchor === FILL_GUIDE_ANCHOR)!;
const guides = [guide, fill];
// What the page prints: getPage() fills the tokens after the schema.
const filled = fillContentTokensDeep(guide, CONTENT_TOKENS);
const filledFill = fillContentTokensDeep(fill, CONTENT_TOKENS);

type Step = SubmissionGuideBlock['steps'][number];
type Body = Step['body'][number];
/** Every sentence a body block prints, in reading order. */
const sentences = (b: Body): string[] => {
  switch (b.kind) {
    case 'paragraph':
    case 'subheading':
      return [b.text];
    case 'steps':
    case 'bullets':
      return b.items.flatMap((item) => [item.text, ...(item.note ? [item.note] : [])]);
    case 'note':
      return [...(b.lead ? [b.lead] : []), ...b.paragraphs];
    case 'faq':
      return b.items.flatMap((item) => [item.q, item.a]);
    case 'shots':
      return [];
  }
};
const stepText = (step: Step) => plain(step.body.flatMap(sentences).join('\n'));
const isList = (b: Body) => b.kind === 'steps' || b.kind === 'bullets';
const listItems = (step: Step) => step.body.flatMap((b) => (b.kind === 'steps' || b.kind === 'bullets' ? b.items : []));

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

describe('guideInline — the marks a guide sentence gets', () => {
  it('prints every «…» as a UI label and the rest as running text', () => {
    expect(guideInline('Нажмите «+ Новая заявка», затем «Начать заявку →».')).toEqual([
      { kind: 'text', text: 'Нажмите ' },
      { kind: 'ui', text: '«+ Новая заявка»' },
      { kind: 'text', text: ', затем ' },
      { kind: 'ui', text: '«Начать заявку →»' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves a sentence without guillemets whole', () => {
    expect(guideInline('Пароль не нужен.')).toEqual([{ kind: 'text', text: 'Пароль не нужен.' }]);
  });

  it('marks the outermost pair when quotes nest', () => {
    expect(guideInline('Экран «Кабинет «Мои заявки»» открыт.')).toEqual([
      { kind: 'text', text: 'Экран ' },
      { kind: 'ui', text: '«Кабинет «Мои заявки»»' },
      { kind: 'text', text: ' открыт.' },
    ]);
  });

  it('never half-marks an unclosed quote', () => {
    expect(guideInline('Строка «без конца.')).toEqual([{ kind: 'text', text: 'Строка «без конца.' }]);
  });

  it('prints a link phrase as the link, even when it is quoted', () => {
    expect(guideInline('Ещё нет — «Зарегистрироваться».', [{ text: '«Зарегистрироваться»', href: '/registration' }])).toEqual([
      { kind: 'text', text: 'Ещё нет — ' },
      { kind: 'link', text: '«Зарегистрироваться»', href: '/registration' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('fails when the sentence lost its link phrase', () => {
    expect(() => guideInline('Текст.', [{ text: 'ссылка', href: '/x' }])).toThrow(/does not contain/);
  });
});

describe('participants.yaml → submission guide', () => {
  it('signs in at the permanent anchor #podat-materialy, fills in on its own page', () => {
    expect(SUBMISSION_GUIDE_ANCHOR).toBe('podat-materialy');
    expect(SUBMISSION_GUIDE_HREF).toBe('/participants#podat-materialy');
    expect(guideStepId(SUBMISSION_GUIDE_ANCHOR, 2)).toBe('podat-materialy-2');
    expect(FILL_GUIDE_ANCHOR).toBe('zapolnit-zayavku');
    expect(FILL_GUIDE_PATH).toBe('/participants/zapolnit-zayavku');
    // The sign-up success card links here through the site config.
    expect(FILL_GUIDE_URL).toBe(FILL_GUIDE_PATH);
    expect(guideStepId(FILL_GUIDE_ANCHOR, 8)).toBe('zapolnit-zayavku-8');
  });

  it('lists the filling page in the sitemap, so the e2e route matrix covers it too', () => {
    expect(STATIC_PUBLIC_ROUTES).toContain(`${FILL_GUIDE_PATH}/`);
  });

  it('sends an old /participants#zapolnit-zayavku link on to the filling page', () => {
    const go = (hash: string) => {
      let replaced: string | null = null;
      const location = { hash, replace: (url: string) => void (replaced = url) };
      new Function('location', FILL_GUIDE_REDIRECT_SCRIPT)(location);
      return replaced;
    };
    expect(go(`#${FILL_GUIDE_ANCHOR}`)).toBe(FILL_GUIDE_PATH);
    expect(go(`#${FILL_GUIDE_ANCHOR}-4`)).toBe(`${FILL_GUIDE_PATH}#${FILL_GUIDE_ANCHOR}-4`);
    expect(go('#podat-materialy')).toBeNull();
    expect(go('#zapolnit-zayavku-x')).toBeNull();
    expect(go('')).toBeNull();
  });

  it('keeps only the sign-in guide on /participants, right before «Проживание»', () => {
    const order = participants.blocks.map((b) => (isGuide(b) ? b.anchor : b.kind));
    const at = order.indexOf('accommodation');
    expect(order.slice(at - 1, at + 1)).toEqual([SUBMISSION_GUIDE_ANCHOR, 'accommodation']);
    expect(participants.blocks.filter(isGuide)).toHaveLength(1);
    expect(fillPage.blocks).toHaveLength(1);
  });

  it('keeps the approved heading and its two steps, then a button to «Как заполнить заявку»', () => {
    expect(plain(guide.heading ?? '')).toBe('Как подать материалы на VIII Конгресс «Ортобиология 2027»');
    expect(guide.steps.map((s) => plain(s.title))).toEqual(['Кто может подать материалы', 'Как войти в кабинет']);
    expect(plain(guide.next?.text ?? '')).toBe('Как заполнить заявку');
    expect(guide.next?.href).toBe(FILL_GUIDE_PATH);
    expect(guide.intro).toBeNull();
  });

  it('heads the filling page «Как заполнить заявку» with one line on where to sign in', () => {
    expect(plain(fillPage.title)).toBe('Как заполнить заявку');
    // The page <h1> is the guide's heading; a second one would repeat it.
    expect(fill.heading).toBeNull();
    expect(plain(fill.intro?.text ?? '')).toBe(
      'Заявку заполняют в личном кабинете. Если вы ещё не вошли — как войти в кабинет.',
    );
    expect(fill.intro?.links.map((l) => [plain(l.text), l.href])).toEqual([['как войти в кабинет', SUBMISSION_GUIDE_HREF]]);
  });

  it('keeps the eight cabinet steps of the approved text, in order', () => {
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

  it('shows no sign-in in the eight steps — the intro line is the one pointer to it', () => {
    const text = JSON.stringify(fillContentTokensDeep(fill.steps, CONTENT_TOKENS));
    expect(fill.steps.flatMap((s) => listItems(s).map((item) => item.cta)).filter(Boolean)).toEqual([]);
    expect(text).not.toContain(CABINET_LOGIN_LABEL);
    expect(text).not.toMatch(/Отправить код|код для входа|войти|вход[ау]?[^а-яё]/i);
    // «Тезисы» points at «Согласие» by its number on this page.
    expect(stepText(fill.steps[3])).toContain('покрывает согласие (раздел 5).');
    expect(plain(fill.steps[4].title)).toBe('Согласие на обработку персональных данных');
  });

  it('walks «Как войти в кабинет» as five numbered sub-steps, the button under the first, then a note', () => {
    const step = guide.steps[1];
    expect(step.body.map((b) => b.kind)).toEqual(['steps', 'note']);
    const items = listItems(step);
    expect(items).toHaveLength(5);
    // The button sits under the sub-step that tells the reader to press it.
    expect(items.map((item) => item.cta)).toEqual(['cabinet-login', null, null, null, null]);
    // A returning reader is told up front that no code is coming (30-day session).
    expect(items.map((item) => item.note && plain(item.note))).toEqual([
      'Если вы уже входили в кабинет с этого устройства, он откроется сразу — код не понадобится.',
      null,
      null,
      null,
      null,
    ]);
    expect(plain(items[0].text)).toContain(`«${CABINET_LOGIN_LABEL}»`);
    // The screenshots follow «Отправить код» (3) and the code letter (4).
    expect(items.map((item) => item.shots.length)).toEqual([0, 0, 1, 2, 0]);
    const note = step.body[1];
    expect(note.kind === 'note' && plain(note.lead ?? '')).toBe('Если не получилось.');
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
    const copy = JSON.stringify(
      [raw, rawFill]
        .flatMap((p) => p.blocks as { kind: string; steps?: unknown[] }[])
        .filter((b) => b.kind === 'submission-guide')
        .flatMap((b) => b.steps!),
    );
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
    const text = (n: number) => stepText(all[n - 1]);
    const oral = plain(SUBMISSION_DEADLINES.oralTalk.display);
    const poster = plain(SUBMISSION_DEADLINES.posterAbstract.display);
    expect(text(1)).toContain('до 23:59 по московскому времени');
    expect(text(1)).toContain(`устные доклады — до ${oral};\nпостерные доклады и тезисы — до ${poster}.`);
    expect(text(8)).toContain(`устный доклад — ${oral};\nпостерный доклад и тезисы — ${poster}.`);
    expect(text(5)).toContain(
      'младше 40 лет на 23 апреля 2027:\nродились 24.04.1987 или позже — можно;\nродились 23.04.1987 или раньше — нельзя',
    );
    // The take-back deadline is dated, as the cabinet now states it
    // (ds-platform #2573) — never «пока приём открыт».
    const takeBack = `устные доклады — до ${oral}, постерные доклады и тезисы — до ${poster}`;
    expect(text(9)).toContain(
      `«Отправлена» — ждёт рассмотрения. До окончания приёма своего вида можно «Забрать на исправление»: ${takeBack}.`,
    );
    expect(text(10)).toContain(`пока заявка «Отправлена» и приём своего вида не закончился (${takeBack})`);
    expect(all.map(stepText).join('\n')).not.toMatch(/приём открыт|открыт приём/);
    expect(JSON.stringify([filled, filledFill])).not.toContain('{{');
  });

  it('links «Зарегистрироваться» to the on-site registration form', () => {
    const first = guide.steps[0].body[0];
    expect(first.kind === 'paragraph' && first.links).toEqual([{ text: '«Зарегистрироваться»', href: '/registration' }]);
  });

  const shotsOf = (step: Step) =>
    step.body.flatMap((b) =>
      b.kind === 'shots' ? b.shots : b.kind === 'steps' || b.kind === 'bullets' ? b.items.flatMap((item) => item.shots) : [],
    );

  it('places the fourteen screenshots, each once, from our bucket', () => {
    const shots = guides.flatMap((g) => g.steps).flatMap(shotsOf);
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

  it('shows each screenshot under the step — and the list item — it illustrates', () => {
    const file = (url: string) => url.split('/').at(-1)!;
    const where = Object.fromEntries(
      guides.flatMap((g) =>
        g.steps.flatMap((s, i) =>
          s.body.flatMap((b) =>
            b.kind === 'shots'
              ? b.shots.map((shot) => [file(shot.url), `${g.anchor}-${i + 1}`])
              : b.kind === 'steps' || b.kind === 'bullets'
                ? b.items.flatMap((item, j) => item.shots.map((shot) => [file(shot.url), `${g.anchor}-${i + 1}.${j + 1}`]))
                : [],
          ),
        ),
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
      // «Отправить» → the error list; «Да, отправить» → the confirmation.
      '05-validation-errors.png': 'zapolnit-zayavku-2.1',
      '07-submit-confirm-v2.png': 'zapolnit-zayavku-2.2',
      '08-poster-birthdate.png': 'zapolnit-zayavku-3',
      '09-poster-age-refusal.png': 'zapolnit-zayavku-3',
      '10-abstract-form.png': 'zapolnit-zayavku-4',
      '06-consent-and-submit.png': 'zapolnit-zayavku-5',
      // The sent card, under the status «Отправлена» it shows.
      '12-sent-card-actions-v2.png': 'zapolnit-zayavku-7.1',
    });
  });
});

/**
 * Owner, 2026-10-08: «инструкции тяжело читать, сплошная простыня; FAQ даже
 * не разбит на строки». What made them so is checkable in the copy: numbered
 * sequences inlined as «1) … 2) …», «→» chains of actions, paragraphs that
 * run on, a FAQ written as one paragraph.
 */
describe('the guides read as a how-to, not a wall of text', () => {
  const allSteps = guides.flatMap((g) => g.steps);
  const paragraphs = (step: Step) =>
    step.body.flatMap((b) => (b.kind === 'paragraph' ? [b.text] : b.kind === 'note' ? b.paragraphs : []));
  // A sentence ends at . ! ? … before a space and a capital, a digit or a quote.
  const sentenceCount = (text: string) => plain(text).split(/(?<=[.!?…])\s+(?=[«А-ЯЁA-Z0-9])/u).length;
  const outsideQuotes = (text: string) => plain(text).replace(/«[^«»]*(?:«[^«»]*»[^«»]*)*»/g, '«…»');

  it('keeps every paragraph to three sentences at most', () => {
    expect(allSteps.flatMap(paragraphs).filter((p) => sentenceCount(p) > 3)).toEqual([]);
  });

  it('writes a sequence as a list, never «1) … 2) …» inline', () => {
    expect(allSteps.map(stepText).join('\n')).not.toMatch(/(^|\s)\d\)\s/);
  });

  it('chains no actions with «→» outside a button label', () => {
    const chains = allSteps.flatMap((s) => s.body.flatMap(sentences)).filter((t) => /\s→\s/.test(outsideQuotes(t)));
    expect(chains).toEqual([]);
  });

  it('breaks every filling step but the FAQ up with a list', () => {
    expect(fill.steps.slice(0, 7).map((s) => s.body.some(isList))).toEqual(Array(7).fill(true));
  });

  it('asks «Частые вопросы» as separate questions, each with its answer', () => {
    const faq = fill.steps[7].body;
    expect(faq.map((b) => b.kind)).toEqual(['faq']);
    const items = faq[0].kind === 'faq' ? faq[0].items : [];
    expect(items.map((item) => plain(item.q))).toEqual([
      'Приём закрылся, а заявка осталась в черновиках. Можно её отправить?',
      'Можно подать четвёртые тезисы?',
      'Постер не подходит по возрасту. Что можно подать?',
      'Можно изменить заявку после отправки?',
      'Можно подать доклад и тезисы по одной работе?',
      'Можно подать несколько заявок?',
    ]);
  });
});

describe('schema guards of the guide', () => {
  const page = (blocks: unknown[]) => ({ title: 'T', blocks });
  const paragraph = (text: string, links: unknown[] = []) => ({ kind: 'paragraph', text, links });
  const step = (body: unknown[] = [paragraph('Текст шага.')]) => ({ title: 'Шаг', body });
  const block = (steps: unknown[], over: Record<string, unknown> = {}) => ({
    kind: 'submission-guide',
    anchor: 'podat-materialy',
    heading: 'H',
    steps,
    ...over,
  });
  const ok = (blocks: unknown[]) => pageSchemaChecked.safeParse(page(blocks));
  const shot = { url: '/media/2027/submissions/x.png', alt: 'a', width: 1, height: 1 };

  it('takes every body block a how-to needs', () => {
    const r = ok([
      block([
        step([
          { kind: 'subheading', text: 'Новая заявка' },
          { kind: 'steps', items: ['Нажмите «+ Новая заявка».', { text: 'Выберите вид.', shots: [shot] }] },
          { kind: 'bullets', items: ['Черновик сохраняется сам.'] },
          { kind: 'note', lead: 'Важно.', paragraphs: ['Файл не нужен.'] },
          { kind: 'shots', shots: [shot] },
          { kind: 'faq', items: [{ q: 'Можно?', a: 'Да.' }] },
        ]),
      ]),
    ]);
    expect(r.success).toBe(true);
    const parsed = r.data?.blocks[0];
    const list = parsed?.kind === 'submission-guide' ? parsed.steps[0].body[1] : null;
    // A bare sentence becomes a full item: no link, no button, no shots.
    expect(list?.kind === 'steps' && list.items[0]).toEqual({
      text: 'Нажмите «+ Новая заявка».',
      links: [],
      cta: null,
      note: null,
      shots: [],
    });
  });

  it('allows a heading-only step', () => {
    expect(ok([block([step([])])]).success).toBe(true);
  });

  it('refuses an empty list, an empty note, an empty FAQ and screenshots of nothing', () => {
    for (const empty of [
      { kind: 'steps', items: [] },
      { kind: 'bullets', items: [] },
      { kind: 'note', lead: null, paragraphs: [] },
      { kind: 'faq', items: [] },
      { kind: 'shots', shots: [] },
    ]) {
      expect(ok([block([step([empty])])]).success, empty.kind).toBe(false);
    }
  });

  it('refuses a body block it does not know', () => {
    expect(ok([block([step([{ kind: 'table', rows: [] }])])]).success).toBe(false);
  });

  it('fails the build when a paragraph stops containing its link phrase', () => {
    const r = ok([block([step([paragraph('Сначала зарегистрируйтесь.', [{ text: '«Зарегистрироваться»', href: '/registration' }])])])]);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must contain');
  });

  it('fails the build when a list item stops containing its link phrase', () => {
    const item = { text: 'Откройте форму.', links: [{ text: 'регистрации', href: '/registration' }] };
    const r = ok([block([step([{ kind: 'bullets', items: [item] }])])]);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must contain');
  });

  it('refuses an off-site link', () => {
    expect(ok([block([step([paragraph('Перейти сюда.', [{ text: 'сюда', href: 'https://example.com/' }])])])]).success).toBe(false);
  });

  it('allows a button under a list item and refuses one the config does not define', () => {
    const list = (cta: string) => ({ kind: 'steps', items: [{ text: 'Один.', cta }] });
    expect(ok([block([step([list('cabinet-login')])])]).success).toBe(true);
    expect(ok([block([step([list('elsewhere')])])]).success).toBe(false);
  });

  it('allows one guide per anchor — the anchors are fixed', () => {
    const r = ok([block([step()]), block([step()])]);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('at most one submission-guide block per anchor');
    expect(ok([block([step()]), block([step()], { anchor: 'zapolnit-zayavku' })]).success).toBe(true);
  });

  it('refuses an anchor that is not one of the fixed ones', () => {
    expect(ok([block([step()], { anchor: 'elsewhere' })]).success).toBe(false);
  });

  it('points a guide on only to a page of this site', () => {
    const next = (href: string) => [block([step()], { next: { text: 'Дальше', href } })];
    expect(ok(next('/participants/zapolnit-zayavku')).success).toBe(true);
    expect(ok(next('https://example.com/')).success).toBe(false);
    expect(ok(next('//example.com/')).success).toBe(false);
  });

  it('fails the build when the intro line stops containing its link phrase', () => {
    const link = { text: 'как войти', href: '/participants#podat-materialy' };
    const intro = (text: string) => [block([step()], { heading: null, intro: { text, links: [link] } })];
    expect(ok(intro('Если не вошли — как войти.')).success).toBe(true);
    const r = ok(intro('Если не вошли — войдите.'));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must contain');
  });

  it('refuses a screenshot hosted anywhere but our storage', () => {
    const bad = { ...shot, url: 'https://example.com/x.png' };
    expect(ok([block([step([{ kind: 'shots', shots: [bad] }])])]).success).toBe(false);
  });
});

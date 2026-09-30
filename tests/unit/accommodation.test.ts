import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { UPCOMING_CONGRESS_VENUE } from '@/config/site';
import { pageSchemaChecked, type AccommodationBlock } from '@/content/schemas';
import {
  ACCOMMODATION_ANCHOR,
  ACCOMMODATION_HREF,
  segment,
  splitLastWord,
  telHref,
} from '@/lib/accommodation';

/**
 * «Проживание» on /participants (Issue #112) — values, not geometry. A promo
 * code with one letter off, or a `tel:` link that dials a different number
 * from the one printed, is valid DOM that passes overflow and axe alike.
 */

const PAGES = fileURLToPath(new URL('../../src/content/pages/', import.meta.url));
const readPage = (slug: string) => parse(readFileSync(`${PAGES}${slug}.yaml`, 'utf8')) as Record<string, unknown>;
const nbspless = (s: string) => s.replace(/ /g, ' ');

const participants = pageSchemaChecked.parse(readPage('participants'));
const acc = participants.blocks.find((b): b is AccommodationBlock => b.kind === 'accommodation');

describe('telHref', () => {
  it.each([
    ['+7 (495) 648-93-00', 'tel:+74956489300'],
    ['+7 (495) 648-93-02', 'tel:+74956489302'],
    ['+7 495 648 93 00', 'tel:+74956489300'],
  ])('dials %s as %s', (printed, href) => {
    expect(telHref(printed)).toBe(href);
  });

  it('refuses a number without the country code — it would dial wrong from abroad', () => {
    expect(() => telHref('8 (495) 648-93-00')).toThrow(/international/);
    expect(() => telHref('648-93-00')).toThrow(/international/);
  });
});

describe('splitLastWord', () => {
  it.each([
    ['Забронировать на сайте отеля', 'Забронировать на сайте ', 'отеля'],
    ['115563, Москва, ул. Шипиловская, 28А', '115563, Москва, ул. Шипиловская, ', '28А'],
    ['на сайте', 'на ', 'сайте'],
    ['Одно', '', 'Одно'],
    ['на\u00a0сайте', 'на\u00a0', 'сайте'],
  ])('splits «%s»', (text, head, last) => {
    expect(splitLastWord(text)).toEqual({ head, last });
  });

  it('loses no character', () => {
    const t = 'Забронировать на сайте отеля';
    const { head, last } = splitLastWord(t);
    expect(head + last).toBe(t);
  });
});

describe('segment', () => {
  it('marks every occurrence and keeps the running text between', () => {
    expect(segment('код ABC и снова ABC.', ['ABC'])).toEqual([
      { text: 'код ', mark: null },
      { text: 'ABC', mark: 'ABC' },
      { text: ' и снова ', mark: null },
      { text: 'ABC', mark: 'ABC' },
      { text: '.', mark: null },
    ]);
  });

  it('matches across a no-break space Typograf put inside the phrase', () => {
    const parts = segment('в отеле «Милан» (Москва)', ['отеле «Милан»']);
    expect(parts[1]).toEqual({ text: 'отеле «Милан»', mark: 'отеле «Милан»' });
  });

  it('treats regex metacharacters in the needle literally', () => {
    expect(segment('пишите a.b@c.d сюда', ['a.b@c.d'])[1].mark).toBe('a.b@c.d');
    expect(() => segment('пишите axb@c.d', ['a.b@c.d'])).toThrow();
  });

  it('fails when the copy lost what it is meant to mark', () => {
    expect(() => segment('Назовите код при бронировании.', ['ОРТОБИОЛОГИЯ'])).toThrow(/ОРТОБИОЛОГИЯ/);
  });

  it('does not take the congress name ОРТОБИОЛОГИЯ-2027 for the promo code ОРТОБИОЛОГИЯ', () => {
    expect(() => segment('Участник конгресса ОРТОБИОЛОГИЯ-2027.', ['ОРТОБИОЛОГИЯ'])).toThrow(/ОРТОБИОЛОГИЯ/);
    expect(segment('Код ОРТОБИОЛОГИЯ для ОРТОБИОЛОГИЯ-2027.', ['ОРТОБИОЛОГИЯ'])).toEqual([
      { text: 'Код ', mark: null },
      { text: 'ОРТОБИОЛОГИЯ', mark: 'ОРТОБИОЛОГИЯ' },
      { text: ' для ОРТОБИОЛОГИЯ-2027.', mark: null },
    ]);
  });

  it('matches whole words only, not inside a longer word', () => {
    expect(() => segment('ПРЕОРТОБИОЛОГИЯ', ['ОРТОБИОЛОГИЯ'])).toThrow();
    expect(() => segment('ОРТОБИОЛОГИЯ2', ['ОРТОБИОЛОГИЯ'])).toThrow();
  });

  it('still marks a needle closed by punctuation', () => {
    expect(segment('код «ОРТОБИОЛОГИЯ».', ['ОРТОБИОЛОГИЯ'])[1].mark).toBe('ОРТОБИОЛОГИЯ');
    expect(segment('пишите на a@b.ru.', ['a@b.ru'])[1]).toEqual({ text: 'a@b.ru', mark: 'a@b.ru' });
  });

  it('passes a sentence without the needle through when not required', () => {
    expect(segment('даты проживания', ['ОРТОБИОЛОГИЯ'], { required: false })).toEqual([
      { text: 'даты проживания', mark: null },
    ]);
  });
});

describe('participants.yaml → accommodation', () => {
  it('is on /participants, after the submission blocks', () => {
    expect(acc).toBeDefined();
    expect(participants.blocks.at(-1)?.kind).toBe('accommodation');
  });

  it('carries the hotel’s facts as the owner supplied them', () => {
    expect(acc!.promo.code).toBe('ОРТОБИОЛОГИЯ');
    expect(acc!.online.url).toBe('https://www.hotelmilan.ru/rooms/');
    expect(acc!.phone.numbers).toEqual(['+7 (495) 648-93-00', '+7 (495) 648-93-02']);
    expect(acc!.phone.numbers.map(telHref)).toEqual(['tel:+74956489300', 'tel:+74956489302']);
    expect(acc!.email.address).toBe('reservation@hotelmilan.ru');
    expect(acc!.group.email).toBe('manager@doctor.school');
    // The organisation's name never parts across lines.
    expect(acc!.group.text).toContain('«Доктор Скул»');
    expect(nbspless(acc!.contacts.address)).toBe('115563, Москва, ул. Шипиловская, 28А');
    expect(nbspless(acc!.promo.terms)).toContain('с 22 по 25 апреля 2027 года');
  });

  it('prints the congress venue’s own address in the lead and the contacts', () => {
    // The address is repeated here (the contacts add a postal code, so it
    // cannot be derived); containment makes a venue move in site.ts fail the
    // build instead of leaving the old address on this page.
    const address = nbspless(UPCOMING_CONGRESS_VENUE.card.address);
    expect(nbspless(acc!.lead)).toContain(address);
    expect(nbspless(acc!.contacts.address)).toContain(address);
  });

  it('allows one accommodation block per page — its ids are fixed', () => {
    const raw = readPage('participants') as { blocks: Record<string, unknown>[] };
    raw.blocks.push(structuredClone(raw.blocks.at(-1)!));
    const r = pageSchemaChecked.safeParse(raw);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path)).toContainEqual(['blocks', raw.blocks.length - 1, 'kind']);
  });

  it('serves the promo-field screenshot from our bucket with its intrinsic dimensions', () => {
    expect(acc!.online.screenshot).toMatchObject({
      url: '/media/2027/accommodation/hotel-promo-field.png',
      width: 560,
      height: 257,
    });
    expect(nbspless(acc!.online.screenshot.alt)).toBe(
      'Окно ввода промокода на странице бронирования отеля «Милан»',
    );
  });

  it('names the promo code in every way of booking', () => {
    for (const text of [acc!.online.text, acc!.phone.text, acc!.email.items[0]]) {
      expect(segment(text, [acc!.promo.code]).some((s) => s.mark)).toBe(true);
    }
  });

  it('fails the build when a sentence stops containing what it marks', () => {
    const raw = readPage('participants') as { blocks: Record<string, unknown>[] };
    const block = raw.blocks.at(-1) as { phone: { text: string } };
    block.phone.text = 'Позвоните в отдел бронирования и назовите промокод.';
    const r = pageSchemaChecked.safeParse(raw);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['blocks', raw.blocks.length - 1, 'phone', 'text']);
  });
});

describe('links into the section', () => {
  it('targets the section anchor', () => {
    expect(ACCOMMODATION_ANCHOR).toBe('accommodation');
    expect(ACCOMMODATION_HREF).toBe('/participants#accommodation');
  });

  it('the FAQ answers «Где остановиться?» with the same promo code, right after the venue', () => {
    const faq = pageSchemaChecked.parse(readPage('faq'));
    const block = faq.blocks[0];
    if (block.kind !== 'faq') throw new Error('faq.yaml must open with the faq block');
    const qs = block.items.map((i) => nbspless(i.q));
    const at = qs.indexOf('Где остановиться?');
    expect(at).toBe(qs.indexOf('Когда и где пройдёт конгресс 2027 года?') + 1);
    const answer = nbspless(block.items[at].a);
    expect(answer).toContain(acc!.promo.code);
    expect(answer).toContain('«Участникам»');
    expect(answer).toContain('«Проживание»');
  });
});

describe('promo code size', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/styles/components.css', import.meta.url)), 'utf8');

  // Two `font-size` declarations in one rule never fall back: `var()` is valid
  // at parse time, so the second always wins, and an unsupported `cqi` then
  // yields `unset`, not the first value (PR #113 review).
  it('applies the fixed fallback only where container units are unsupported', () => {
    const fallback = /@supports not \(width: 1cqi\) \{\s*\.ob-acc__code \{\s*font-size: var\(--acc-code-size-fallback\);\s*\}\s*\}/;
    expect(css).toMatch(fallback);
    expect(css.replace(fallback, '')).not.toContain('--acc-code-size-fallback');
  });
});

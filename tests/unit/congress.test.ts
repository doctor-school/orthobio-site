import { describe, expect, it } from 'vitest';

import {
  displaySize,
  groupPartners,
  groupSessionsByDay,
  nbsp,
  ordinalLabel,
  plural,
  roman,
  videoHost,
  yearHighlights,
  type Session,
} from '@/lib/congress';
import type { CongressEntry } from '@/content';

/**
 * Unit tests for the pure derivations behind the archive UI.
 *
 * Why this file exists: the e2e suite asserts geometry and accessibility, so a
 * wrong VALUE sails through it — «фото 12» (swapped `nbsp()` arguments) is
 * perfectly valid DOM and passed 189 e2e tests plus a full responsive/a11y
 * audit before review caught it by reading the built HTML. Values are cheap to
 * pin here, so they are pinned here.
 */

type Congress = CongressEntry['data'];

const NBSP = ' ';

/** Minimal valid congress record; each test overrides only what it exercises. */
const congress = (overrides: Partial<Congress> = {}): Congress =>
  ({
    year: 2025,
    number: 6,
    title: 'ОРТОБИОЛОГИЯ 2025',
    dates: '18-19 апреля 2025',
    startDate: null,
    endDate: null,
    place: null,
    greetings: [],
    committee: [],
    program: null,
    photos: [],
    cover: null,
    posters: [],
    videos: [],
    theses: null,
    partners: [],
    draft: false,
    ...overrides,
  }) as Congress;

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    title: 'Сессия',
    date: null,
    time: null,
    hall: null,
    moderators: [],
    talks: [],
    note: null,
    ...overrides,
  }) as Session;

describe('nbsp', () => {
  it('joins a value and its word with a non-breaking space, value first', () => {
    expect(nbsp(12, 'фото')).toBe(`12${NBSP}фото`);
  });

  it('never emits a plain space (the count must not orphan on a 360px screen)', () => {
    expect(nbsp(3, 'видео')).not.toContain(' ');
  });
});

describe('plural', () => {
  const forms = ['сессия', 'сессии', 'сессий'] as const;

  it.each([
    [1, 'сессия'],
    [2, 'сессии'],
    [3, 'сессии'],
    [4, 'сессии'],
    [5, 'сессий'],
    [10, 'сессий'],
    // The 11–14 exception: they take the «many» form despite ending in 1–4.
    [11, 'сессий'],
    [12, 'сессий'],
    [13, 'сессий'],
    [14, 'сессий'],
    [21, 'сессия'],
    [22, 'сессии'],
    [25, 'сессий'],
    [101, 'сессия'],
    [104, 'сессии'],
    [111, 'сессий'],
    [0, 'сессий'],
  ])('picks the right form for %i', (n, expected) => {
    expect(plural(n, forms)).toBe(expected);
  });
});

describe('roman', () => {
  it.each([
    [1, 'I'],
    [2, 'II'],
    [4, 'IV'],
    [5, 'V'],
    [6, 'VI'],
    [7, 'VII'],
    [8, 'VIII'],
    [9, 'IX'],
    [14, 'XIV'],
    [40, 'XL'],
    [80, 'LXXX'],
    [1990, 'MCMXC'],
  ])('renders %i as %s', (n, expected) => {
    expect(roman(n)).toBe(expected);
  });
});

describe('ordinalLabel', () => {
  it('prints the Roman ordinal with a non-breaking space', () => {
    expect(ordinalLabel(7)).toBe(`VII${NBSP}конгресс`);
  });

  it('says just «конгресс» when the ordinal was never verified', () => {
    expect(ordinalLabel(null)).toBe('конгресс');
  });
});

describe('groupSessionsByDay', () => {
  it('orders days ascending and numbers them from 1', () => {
    const groups = groupSessionsByDay([
      session({ title: 'Второй день', date: new Date('2025-04-19') }),
      session({ title: 'Первый день', date: new Date('2025-04-18') }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['День 1 — 18 апреля', 'День 2 — 19 апреля']);
    expect(groups[0].sessions[0].title).toBe('Первый день');
  });

  it('keeps content order inside a day', () => {
    const day = new Date('2025-04-18');
    const groups = groupSessionsByDay([
      session({ title: 'A', date: day }),
      session({ title: 'B', date: day }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('puts undated sessions last under an honest label, never under a made-up date', () => {
    const groups = groupSessionsByDay([
      session({ title: 'Без даты' }),
      session({ title: 'С датой', date: new Date('2025-04-18') }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['День 1 — 18 апреля', 'Дата сессии не указана']);
    expect(groups[1].sessions[0].title).toBe('Без даты');
  });

  it('returns nothing for no sessions', () => {
    expect(groupSessionsByDay([])).toEqual([]);
  });
});

describe('displaySize', () => {
  it('scales a camera original down to the display width, preserving the ratio', () => {
    expect(displaySize(5811, 3874, 640)).toEqual({ width: 640, height: 427 });
  });

  it('never upscales an image that is already smaller than the target', () => {
    expect(displaySize(320, 180, 640)).toEqual({ width: 320, height: 180 });
  });

  it('passes an exact-fit size through untouched', () => {
    expect(displaySize(640, 360, 640)).toEqual({ width: 640, height: 360 });
  });
});

describe('groupPartners', () => {
  const partner = (name: string, tier: string) =>
    ({ name, tier, logo: null, url: null }) as Congress['partners'][number];

  it('keeps the canonical tier order regardless of content order', () => {
    const groups = groupPartners([
      partner('Инфо', 'info'),
      partner('Организатор', 'organizer'),
      partner('Генеральный', 'general'),
    ]);
    expect(groups.map((g) => g.tier)).toEqual(['organizer', 'general', 'info']);
  });

  it('drops empty tiers and labels the rest in Russian', () => {
    const groups = groupPartners([partner('ПРОМОМЕД', 'strategic')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Стратегические партнёры');
  });

  it('returns nothing when the year published no partners', () => {
    expect(groupPartners([])).toEqual([]);
  });
});

describe('videoHost', () => {
  it.each([
    ['https://www.youtube.com/watch?v=c-RvCZ2GPKM', 'YouTube'],
    ['https://youtu.be/c-RvCZ2GPKM', 'YouTube'],
    ['https://rutube.ru/video/abc123/', 'Rutube'],
  ])('labels %s as %s', (url, expected) => {
    expect(videoHost(url)).toBe(expected);
  });
});

describe('yearHighlights', () => {
  it('prints counts BEFORE their noun — the «фото 12» regression', () => {
    const tags = yearHighlights(
      congress({
        photos: [{}, {}] as Congress['photos'],
        videos: [{}, {}, {}] as Congress['videos'],
      }),
    );
    expect(tags).toEqual([`2${NBSP}фото`, `3${NBSP}видео`]);
  });

  it('counts sessions and talks with the right plural forms', () => {
    const tags = yearHighlights(
      congress({
        program: {
          pdf: null,
          sessions: [
            session({ talks: [{ title: 'A', speakers: [] }] }),
            session({ talks: [{ title: 'B', speakers: [] }] }),
          ],
        } as Congress['program'],
      }),
    );
    expect(tags).toEqual([`2${NBSP}сессии`, `2${NBSP}доклада`]);
  });

  it('lists a program PDF and a theses volume when the year has them', () => {
    const tags = yearHighlights(
      congress({
        program: { pdf: '/media/2026/docs/prog.pdf', sessions: [] } as Congress['program'],
        theses: { pdf: '/media/2026/docs/material.pdf', title: null } as Congress['theses'],
      }),
    );
    expect(tags).toEqual(['программа (PDF)', 'тезисы']);
  });

  it('emits NOTHING for a year with no material — never a fabricated tag', () => {
    expect(yearHighlights(congress())).toEqual([]);
  });

  it('does not print a talk count when sessions carry no talks', () => {
    const tags = yearHighlights(
      congress({ program: { pdf: null, sessions: [session()] } as Congress['program'] }),
    );
    expect(tags).toEqual([`1${NBSP}сессия`]);
  });
});

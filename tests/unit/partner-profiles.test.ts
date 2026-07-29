import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import { congressSchema, congressSchemaChecked } from '@/content/schemas';
import {
  descriptionBlocks,
  metaDescription,
  META_DESCRIPTION_MAX,
  partnerCardHref,
  partnerProfiles,
  profileHref,
  telHref,
} from '@/lib/partners';

/**
 * Partner profile pages (Issue #24) — the values the other gates cannot see.
 *
 * The e2e suite proves a profile page renders, is accessible and does not
 * overflow. It cannot prove the page shows the RIGHT company: a profile whose
 * address belongs to its neighbour renders perfectly. The schema, in turn,
 * proves a slug is well-formed but knows nothing about the collection. So what
 * lives here is the identity logic — slug shape, one slug one page, which href
 * a card gets — plus the content counts that pin the rescue.
 */

const partner = (over: Record<string, unknown> = {}) => ({
  name: 'ПанБио Фарм',
  tier: 'general',
  ...over,
});

const parsePartner = (over: Record<string, unknown> = {}) =>
  congressSchema.safeParse({ year: 2026, partners: [partner(over)] });

describe('partnerSchema → profile fields', () => {
  it('defaults every profile field to its «нет данных» value', () => {
    const r = parsePartner();
    expect(r.success).toBe(true);
    const p = r.data!.partners[0];
    // Null slug is the common case: most partners never had a profile page.
    expect(p.slug).toBeNull();
    expect(p.address).toBeNull();
    expect(p.contacts).toBeNull();
    expect(p.description).toEqual([]);
  });

  it('accepts a lowercase kebab-case slug', () => {
    for (const slug of ['fbk', 'dr-reddys', 'multi-systems-technology', 'ns03']) {
      expect(parsePartner({ slug }).success, slug).toBe(true);
    }
  });

  it('rejects the old site’s own id shapes — those live in the redirect map', () => {
    // Exactly the two forms the operator used: a dot and mixed case. Letting
    // them through would put `/partners/CSCPharmaRussia/` on our site.
    for (const slug of ['dr.reddys', 'CSCPharmaRussia', 'Dr-Reddys']) {
      expect(parsePartner({ slug }).success, slug).toBe(false);
    }
  });

  it('rejects slugs that would break the route or the URL', () => {
    for (const slug of ['', 'a--b', '-a', 'a-', 'a/b', 'a b', 'a_b', 'ён']) {
      expect(parsePartner({ slug }).success, JSON.stringify(slug)).toBe(false);
    }
  });

  it('keeps the slug verbatim — never routed through the typographer', () => {
    // A slug is an id. If prose() ever reached it, «dr-reddys» would acquire a
    // non-breaking space or a typographic dash and the route would 404.
    const r = parsePartner({ slug: 'dr-reddys' });
    expect(r.data!.partners[0].slug).toBe('dr-reddys');
  });

  it('applies RU typography to the address and the description, not to contacts', () => {
    const r = parsePartner({
      slug: 'x',
      address: '115035, Москва, "Овчинниковская наб." 20',
      description: ['Компания "Икс" - лидер рынка.'],
      contacts: { email: 'a@b.ru', phone: '+ 7 495 000 00 00' },
    });
    expect(r.success).toBe(true);
    const p = r.data!.partners[0];
    // Ёлочки and an em dash are the typographer's signature.
    expect(p.address).toContain('«Овчинниковская наб.»');
    expect(p.description[0]).toContain('«Икс»');
    expect(p.description[0]).toContain('—');
    // A phone is a display token: the spacing it was published with is the
    // spacing it keeps, and no dash rule may touch it.
    expect(p.contacts!.phone).toBe('+ 7 495 000 00 00');
  });

  it('rejects a malformed contact email', () => {
    expect(parsePartner({ contacts: { email: 'not-an-email', phone: null } }).success).toBe(false);
  });

  it('allows contacts with only one channel filled', () => {
    const r = parsePartner({ contacts: { email: null, phone: '+7 495 000 00 00' } });
    expect(r.success).toBe(true);
    expect(r.data!.partners[0].contacts).toEqual({ email: null, phone: '+7 495 000 00 00' });
  });
});

describe('congressSchemaChecked → slug uniqueness within a year', () => {
  const withPartners = (partners: Record<string, unknown>[]) =>
    congressSchemaChecked.safeParse({ year: 2026, partners });

  it('rejects two partners of one year claiming the same slug', () => {
    const r = withPartners([
      partner({ name: 'А', slug: 'same' }),
      partner({ name: 'Б', slug: 'same' }),
    ]);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/duplicate profile slug/);
  });

  it('allows many partners without a slug — null is not a duplicate', () => {
    expect(withPartners([partner({ name: 'А' }), partner({ name: 'Б' })]).success).toBe(true);
  });
});

describe('partnerProfiles', () => {
  const year = (y: number, partners: Record<string, unknown>[]) => ({
    year: y,
    partners: congressSchema.parse({ year: y, partners }).partners,
  });

  it('collects only partners that carry a slug', () => {
    const profiles = partnerProfiles([
      year(2026, [partner({ name: 'А', slug: 'a' }), partner({ name: 'Б' })]),
    ]);
    expect(profiles.map((p) => p.slug)).toEqual(['a']);
  });

  it('merges one organization across years into ONE page, newest year first', () => {
    // Sources arrive newest-first (getCongressYears order).
    const profiles = partnerProfiles([
      year(2026, [partner({ name: 'А', slug: 'a', address: 'новый адрес' })]),
      year(2025, [partner({ name: 'А', slug: 'a', address: 'старый адрес' })]),
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].years).toEqual([2026, 2025]);
    // The newest record wins: an address is a current fact, not a historical one.
    expect(profiles[0].partner.address).toBe('новый адрес');
  });

  it('throws when two DIFFERENT organizations claim one slug across years', () => {
    expect(() =>
      partnerProfiles([
        year(2026, [partner({ name: 'А', slug: 'a' })]),
        year(2025, [partner({ name: 'Б', slug: 'a' })]),
      ]),
    ).toThrow(/claimed by two organizations/);
  });
});

describe('profileHref / partnerCardHref', () => {
  it('builds the directory-format route, trailing slash included', () => {
    // Astro emits /partners/<slug>/index.html; without the trailing slash the
    // redirect targets and the links would disagree by one hop.
    expect(profileHref('dr-reddys')).toBe('/partners/dr-reddys/');
  });

  it('prefers the profile over the partner’s own website', () => {
    const p = congressSchema.parse({
      year: 2026,
      partners: [partner({ slug: 'x', url: 'https://example.ru' })],
    }).partners[0];
    expect(partnerCardHref(p)).toBe('/partners/x/');
  });

  it('falls back to the external site when there is no profile', () => {
    const p = congressSchema.parse({
      year: 2026,
      partners: [partner({ url: 'https://example.ru' })],
    }).partners[0];
    expect(partnerCardHref(p)).toBe('https://example.ru');
  });

  it('returns null when a partner is a plain roster entry', () => {
    const p = congressSchema.parse({ year: 2026, partners: [partner()] }).partners[0];
    expect(partnerCardHref(p)).toBeNull();
  });
});

/**
 * Counts of the rescue itself, pinned per year.
 *
 * Why: the crawl of the old site is not reproducible forever — the operator's
 * platform is being retired, and once it is gone nothing but this file records
 * how many profiles were saved. A partner silently losing its `description`
 * while a roster is edited would otherwise leave a page that renders, passes
 * axe, and says nothing.
 */
describe('rescued profile content, per year', () => {
  const yearFile = (y: number) =>
    congressSchema.parse(parse(readFileSync(`src/content/congress/${y}.yaml`, 'utf8')));

  const PROFILES_PER_YEAR: Record<number, number> = {
    2021: 0,
    2022: 0,
    2023: 0,
    2024: 0,
    2025: 0,
    // The 22 exhibitors of /exhibition — the only year of the archive whose
    // partners ever had profile pages on the old site.
    2026: 22,
  };

  it.each(Object.entries(PROFILES_PER_YEAR))('%s has the expected profile count', (y, expected) => {
    const profiles = yearFile(Number(y)).partners.filter((p) => p.slug !== null);
    expect(profiles).toHaveLength(expected);
  });

  it('gives every 2026 profile an address, contacts and a description', () => {
    for (const p of yearFile(2026).partners.filter((x) => x.slug !== null)) {
      expect(p.address, `${p.name} address`).toBeTruthy();
      expect(p.description.length, `${p.name} description`).toBeGreaterThan(0);
      // Северная звезда published neither email nor phone — a null contacts
      // block is a real state, so the assertion is «email or phone or null»,
      // never «always present».
      if (p.contacts !== null) {
        expect(
          p.contacts.email ?? p.contacts.phone,
          `${p.name} contacts block with nothing in it`,
        ).toBeTruthy();
      }
    }
  });

  it('keeps profile slugs unique across the whole archive', () => {
    const slugs = [2021, 2022, 2023, 2024, 2025, 2026]
      .flatMap((y) => yearFile(y).partners)
      .map((p) => p.slug)
      .filter((s): s is string => s !== null);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});


/**
 * `tel:` targets (PR #40 review, IMPORTANT).
 *
 * The template used to build the href with `phone.replace(/[^+\d]/g, '')`,
 * which turned «КардиоМед»'s «+7 495 955 52 57 / 58 / 40» — one switchboard
 * with three extensions — into `tel:+749595552575840`, a 16-digit number that
 * does not exist. The visible text stayed correct, so only someone who TAPPED
 * it would ever find out: precisely the class of wrong VALUE the e2e suite
 * cannot see, which is why the logic moved here.
 */
describe('telHref', () => {
  it('refuses to guess when the string holds several numbers', () => {
    // The real regression. One unlinked phone is honest; one wrong tel: is not,
    // and reconstructing «/ 58 / 40» would invent digits nobody published.
    expect(telHref('+7 495 955 52 57 / 58 / 40')).toBeNull();
  });

  it.each([
    ['+7 495 111 64 95, +7 499 252 36 09'],
    ['+7 495 111 64 95; +7 499 252 36 09'],
    ['+7 495 111 64 95 доб. 12'],
  ])('refuses %s', (phone) => {
    expect(telHref(phone)).toBeNull();
  });

  it('builds a dialable target for a plain single number', () => {
    expect(telHref('+7 495 785 01 00')).toBe('+74957850100');
    // The space after «+» is how one partner published it.
    expect(telHref('+ 7495 795 39 39')).toBe('+74957953939');
    // Already compact.
    expect(telHref('+74957786210')).toBe('+74957786210');
  });

  it('keeps a domestic number without inventing a country code', () => {
    // «8 800 …» must NOT gain a «+»: that would assert an international form
    // the source never published.
    expect(telHref('8 800 550 67 57')).toBe('88005506757');
  });

  it('returns null for a string with too few digits to dial', () => {
    expect(telHref('')).toBeNull();
    expect(telHref('нет данных')).toBeNull();
    expect(telHref('12345')).toBeNull();
  });

  it('produces a target of digits and at most a leading + — nothing else', () => {
    // Whatever comes back is pasted straight into href="tel:…".
    for (const phone of ['+7 (495) 785-01-00', '8 800 550 67 57']) {
      expect(telHref(phone)).toMatch(/^\+?\d+$/);
    }
  });
});

/**
 * Every phone actually published in the content must resolve to one of the two
 * intended states — a clean dialable target, or a deliberate null. This is the
 * assertion that would have caught the КардиоМед defect on real data.
 */
describe('telHref over the live 2026 roster', () => {
  const partners = congressSchema.parse(
    parse(readFileSync('src/content/congress/2026.yaml', 'utf8')),
  ).partners;

  it('never emits a malformed target for any published phone', () => {
    const phones = partners
      .map((p) => p.contacts?.phone)
      .filter((v): v is string => typeof v === 'string');
    expect(phones.length).toBeGreaterThan(0);
    for (const phone of phones) {
      const href = telHref(phone);
      if (href === null) continue;
      expect(href, phone).toMatch(/^\+?\d{10,15}$/);
    }
  });

  it('leaves exactly the multi-extension entry unlinked', () => {
    const unlinked = partners
      .filter((p) => p.contacts?.phone && telHref(p.contacts.phone) === null)
      .map((p) => p.name);
    expect(unlinked).toEqual(['КардиоМед']);
  });
});

/**
 * Meta descriptions (PR #40 review, MINOR). Several partners open with a
 * 450-character paragraph; a search engine cuts that at ~160 mid-word.
 */
describe('metaDescription', () => {
  it('returns short text untouched', () => {
    expect(metaDescription('Короткое описание компании.')).toBe('Короткое описание компании.');
  });

  it('cuts at a sentence boundary when one fits', () => {
    // The capital after the full stop is part of the signal — it is what tells
    // a sentence end from «в г. Хайдерабад» (next case).
    const text = `${'а'.repeat(80)} конец. ${'Б'.repeat(200)}`;
    const out = metaDescription(text);
    expect(out.endsWith('конец.')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
  });

  it('does not mistake a Russian abbreviation for the end of a sentence', () => {
    // «в г. Хайдерабад» — a naive «. » search would end the snippet on «г.».
    const text = `Компания с головным офисом в г. Хайдерабад, Индия, ${'и работает долго '.repeat(20)}`;
    const out = metaDescription(text);
    expect(out).not.toMatch(/в г\.$/);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX + 1);
  });

  it('falls back to a word boundary with an ellipsis', () => {
    const out = metaDescription(`${'слово '.repeat(60)}`);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX + 1);
  });

  it('keeps every real profile description within budget', () => {
    const partners = congressSchema.parse(
      parse(readFileSync('src/content/congress/2026.yaml', 'utf8')),
    ).partners;
    const described = partners.filter((p) => p.slug !== null && p.description.length > 0);
    expect(described.length).toBe(22);
    for (const p of described) {
      const meta = metaDescription(p.description[0]);
      expect(meta.length, `${p.name}: ${meta.length} chars`).toBeLessThanOrEqual(
        META_DESCRIPTION_MAX + 1,
      );
      expect(meta.length).toBeGreaterThan(0);
    }
  });
});

/**
 * List structure (PR #40 review, MINOR). ПанБио Фарм's seven «· ревматология,»
 * entries were rendering as seven paragraphs each opening with a literal «·»:
 * no list for a screen reader to announce, and a typographic glyph doing
 * markup's job. The marker stays in the YAML — it is the only signal that
 * survives the CMS loader swap — and is translated to a real <ul> here.
 */
describe('descriptionBlocks', () => {
  it('leaves ordinary paragraphs alone', () => {
    expect(descriptionBlocks(['Первый.', 'Второй.'])).toEqual([
      { kind: 'text', text: 'Первый.' },
      { kind: 'text', text: 'Второй.' },
    ]);
  });

  it('groups a run of bullet entries into one list and strips the marker', () => {
    expect(
      descriptionBlocks(['Направления:', '· ревматология,', '· травматология,', 'И далее.']),
    ).toEqual([
      { kind: 'text', text: 'Направления:' },
      { kind: 'list', items: ['ревматология,', 'травматология,'] },
      { kind: 'text', text: 'И далее.' },
    ]);
  });

  it('starts a new list when a paragraph interrupts the run', () => {
    const blocks = descriptionBlocks(['· а', 'проза', '· б']);
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'text', 'list']);
  });

  it('turns the real ПанБио Фарм entry into a single seven-item list', () => {
    const panbio = congressSchema
      .parse(parse(readFileSync('src/content/congress/2026.yaml', 'utf8')))
      .partners.find((p) => p.slug === 'panbio-pharm');
    const blocks = descriptionBlocks(panbio!.description);
    const lists = blocks.filter((b) => b.kind === 'list');
    expect(lists).toHaveLength(1);
    expect(lists[0].kind === 'list' && lists[0].items).toHaveLength(7);
    // No marker survives into the rendered item.
    for (const item of lists[0].kind === 'list' ? lists[0].items : []) {
      expect(item.startsWith('·')).toBe(false);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { mediaUrl } from '../../src/config/site';

/**
 * The rescued partner marks (Issue #22) are 49 objects in `orthobio-media`
 * under `logos/`, referenced from the year YAML as `/media/logos/<file>`.
 *
 * Why the values are pinned here: nothing else can see them. The schema only
 * proves a logo path is root-relative or on our own storage — `/media/logos/
 * promomedd.png` satisfies it. The e2e suite asserts geometry and a11y, and an
 * <img> whose src 404s still occupies its reserved 120×72 box, still carries
 * its alt text, and still passes both overflow and axe: the tier grid looks
 * exactly right with every mark missing. So a one-character typo in a path, or
 * a key dropped while editing a roster, would ship silently and be found by a
 * reader, not by CI (the same class of miss as «фото 12» in PR #14).
 *
 * Three things are therefore pinned: the URL shape every mark resolves to, the
 * per-year coverage counts, and the two-way correspondence between the objects
 * the manifest says were uploaded and the paths the content actually
 * references.
 */

const CONGRESS_DIR = fileURLToPath(new URL('../../src/content/congress', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../../docs/assets-manifest.yaml', import.meta.url));

/** Where the bucket lives, spelled out rather than imported — see below. */
const LOGO_URL_PREFIX = 'https://s3.twcstorage.ru/orthobio-media/logos/';

interface Partner {
  name: string;
  tier: string;
  logo: string | null;
  url: string | null;
}

interface Year {
  file: string;
  year: number;
  draft: boolean;
  partners: Partner[];
}

const years: Year[] = readdirSync(CONGRESS_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .map((file) => {
    const data = parse(readFileSync(`${CONGRESS_DIR}/${file}`, 'utf8')) as Partial<Year>;
    return {
      file,
      year: data.year as number,
      draft: data.draft === true,
      partners: (data.partners ?? []) as Partner[],
    };
  });

/**
 * `2099.yaml` is a smoke fixture (`draft: true`, filtered out of
 * `getStaticPaths()`), and its single logo is a deliberately fictional path
 * demonstrating the field. Published years only, or this file would assert
 * facts about a page that is never built.
 */
const published = years.filter((y) => !y.draft).sort((a, b) => a.year - b.year);

const withLogo = published.flatMap((y) =>
  y.partners.filter((p) => p.logo).map((p) => ({ ...p, year: y.year, logo: p.logo as string })),
);

const referenced = new Set(withLogo.map((p) => p.logo));

const manifest = parse(readFileSync(MANIFEST, 'utf8')) as {
  logos: {
    counters: { objects: number; object_bytes: number };
    items: {
      id: string;
      org: string;
      source_alt: string | null;
      s3_key: string;
      s3_status: string;
      object: { w: number; h: number; bytes: number; sha256: string };
    }[];
  };
};

const manifestPaths = manifest.logos.items.map((i) => `/media/${i.s3_key}`);

describe('every rescued mark resolves to an object in the bucket', () => {
  /**
   * Lowercase slug, one known raster/vector extension, directly under
   * `logos/` — the exact shape `scripts/rescue-partner-logos.mjs` writes. A
   * path with a stray space, an uppercase letter or a nested directory is a
   * key that does not exist in the bucket.
   */
  const SHAPE = /^\/media\/logos\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|svg|webp)$/;

  it.each([...referenced].sort())('%s has the shape of a logos/ key', (logo) => {
    expect(logo).toMatch(SHAPE);
  });

  it('maps to the public bucket URL through mediaUrl, with no doubled slash', () => {
    // The prefix is asserted against a literal rather than against
    // MEDIA_BASE_URL: importing the constant would make the test agree with
    // whatever the constant says, including a broken value.
    for (const logo of referenced) {
      const url = mediaUrl(logo);
      expect(url).toBe(LOGO_URL_PREFIX + logo.slice('/media/logos/'.length));
      expect(url.slice('https://'.length)).not.toContain('//');
    }
  });

  it('never leaves a partner pointing at an external CDN (ТЗ §4)', () => {
    // The marks were rescued precisely to stop depending on congress-ph and
    // Creatium; a path that still names them defeats the whole issue.
    for (const p of withLogo) expect(p.logo).toMatch(/^\/media\//);
  });
});

describe('coverage per year is pinned', () => {
  /**
   * A dropped `logo:` key is invisible — the partner simply falls back to its
   * text card, which is a legitimate finished state for the 19 partners with no
   * surviving mark. These counts are what tell the two cases apart.
   */
  const COVERAGE: Record<number, { partners: number; withLogo: number }> = {
    2021: { partners: 3, withLogo: 1 },
    2022: { partners: 0, withLogo: 0 },
    2023: { partners: 0, withLogo: 0 },
    2024: { partners: 14, withLogo: 7 },
    2025: { partners: 34, withLogo: 28 },
    2026: { partners: 52, withLogo: 48 },
  };

  it('covers every published year — a new year must be pinned too', () => {
    expect(published.map((y) => y.year)).toEqual(Object.keys(COVERAGE).map(Number));
  });

  it.each(published.map((y) => [y.year, y] as const))('%i', (year, y) => {
    expect(y.partners).toHaveLength(COVERAGE[year].partners);
    expect(y.partners.filter((p) => p.logo)).toHaveLength(COVERAGE[year].withLogo);
  });

  it('renders a mark for 84 of the 103 partners in the archive', () => {
    expect(published.flatMap((y) => y.partners)).toHaveLength(103);
    expect(withLogo).toHaveLength(84);
  });

  it('draws those 84 cards from 49 distinct objects', () => {
    // Fewer objects than cards because the library is keyed by ORGANIZATION:
    // one brand mark serves every edition that organization took part in.
    expect(referenced.size).toBe(49);
  });
});

describe('each partner carries its OWN mark', () => {
  /**
   * The failure this catches is a SWAP: exchange `haleon.png` and
   * `servier.png` between two partners and every other assertion in this file
   * still passes — shapes valid, counts unchanged, both paths in the manifest,
   * both objects referenced. Only «right company ↔ right logo» is violated
   * (PR #36 review).
   *
   * The manifest records the organization each object was rescued for, so the
   * partner's name and that `org` must share a word. 78 of the 84 pairings
   * agree outright.
   */
  const orgOf = new Map(manifest.logos.items.map((i) => [`/media/${i.s3_key}`, i.org]));

  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(' ')
        .filter((w) => w.length >= 3),
    );

  /**
   * The other 6: the roster names the company as the source page spelled it,
   * the manifest names the legal entity behind the mark, and the two are in
   * different alphabets. Each pair is pinned WHOLE, so exchanging two of these
   * six with each other is still caught — the resulting pair is not on the
   * list.
   */
  const TRANSLITERATED: readonly (readonly [string, string])[] = [
    ['Haleon', 'Хелеон Рус, АО'],
    ['Promomed', 'ПРОМОМЕД, ПАО'],
    ['Viatris', 'Виатрис, ООО'],
    ['Др. Реддис', 'Dr. Reddy’s Laboratories'],
    ['СиЭсСи', 'CSC Pharma Russia'],
  ];

  it.each(withLogo.map((p) => [`${p.year} ${p.name}`, p] as const))(
    '%s wears the mark rescued for it',
    (_label, p) => {
      const org = orgOf.get(p.logo) as string;
      const shared = [...words(p.name)].some((w) => words(org).has(w));
      const listed = TRANSLITERATED.some(([name, o]) => name === p.name && o === org);
      expect(shared || listed, `«${p.name}» wears a mark rescued for «${org}»`).toBe(true);
    },
  );

  /**
   * Known gap, stated rather than papered over: this proves a partner's name
   * agrees with the name recorded for its object, NOT that either matches what
   * the mark actually depicts. Two entries of the same brand can still be
   * exchanged undetected — `promomed.png` under «Promomed» vs «Промомед МД» is
   * the same object either way, so the swap is a no-op. The evidence that
   * closes the remaining distance is `source_alt` in the manifest: the alt the
   * source page itself put on the mark, agreeing with `org` on all 27 objects
   * that carry one. The other 22 ship no alt at source and are bound by URL
   * alone — no machine can do better from here, and this file says so instead
   * of implying coverage it does not have.
   */
  it('pins the alt-confirmed bindings so a later edit cannot quietly drop them', () => {
    const confirmed = manifest.logos.items.filter((i) => i.source_alt);
    expect(confirmed).toHaveLength(27);
    for (const item of confirmed) {
      const shared = [...words(item.source_alt as string)].some((w) => words(item.org).has(w));
      expect(shared, `${item.id}: alt «${item.source_alt}» vs org «${item.org}»`).toBe(true);
    }
  });
});

describe('manifest and content agree on what was uploaded', () => {
  it('lists 49 uploaded objects, each key once', () => {
    expect(manifest.logos.items).toHaveLength(49);
    expect(manifest.logos.counters.objects).toBe(manifest.logos.items.length);
    expect(new Set(manifestPaths).size).toBe(manifestPaths.length);
    for (const item of manifest.logos.items) expect(item.s3_status).toBe('uploaded');
  });

  it('has no content path missing from the manifest — that path would 404', () => {
    const known = new Set(manifestPaths);
    const phantom = withLogo.filter((p) => !known.has(p.logo)).map((p) => `${p.year} ${p.name}`);
    expect(phantom).toEqual([]);
  });

  /**
   * The per-item `object:` blocks and the section counters are edited by hand
   * every time the objects are re-derived (49 of them in Issue #22, 47 rewritten
   * again in Issue #39). Nothing else looks at both: the assertions above count
   * KEYS, and a mistyped digit inside `bytes:` leaves every key intact. So a
   * typo in a 68-line diff would ship, and the manifest — which is the repo's
   * only record of what the bucket holds — would quietly stop describing it.
   *
   * The sum is the cheap end of the check. It cannot see a wrong sha256, but it
   * catches every edit that touched `bytes:` without touching the counter, and
   * every counter edited without the items — which is the shape the mistake
   * actually takes.
   */
  it('has counters that add up to the items they count', () => {
    const { counters, items } = manifest.logos;
    expect(items).toHaveLength(counters.objects);
    expect(items.reduce((sum, i) => sum + i.object.bytes, 0)).toBe(counters.object_bytes);
  });

  it('records a positive size and pinned sha256 for every object', () => {
    // A dropped or zeroed field would otherwise make the sum above agree with a
    // counter that was «fixed» to match it.
    for (const i of manifest.logos.items) {
      expect(i.object.bytes, i.id).toBeGreaterThan(0);
      expect(i.object.w, i.id).toBeGreaterThan(0);
      expect(i.object.h, i.id).toBeGreaterThan(0);
      expect(i.object.sha256, i.id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('has no uploaded object nobody references — that mark would be invisible', () => {
    // NOT «exactly one entry»: 26 of the 49 objects are referenced by several
    // entries on purpose (an organization that took part in several editions,
    // and «Promomed»/«Промомед МД», the same brand in two tiers of 2025). At
    // least one reference is the real invariant — it is what turns a rescued
    // object into a rendered card.
    const orphans = manifestPaths.filter((k) => !referenced.has(k));
    expect(orphans).toEqual([]);
  });
});

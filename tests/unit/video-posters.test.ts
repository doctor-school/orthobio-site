import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { mediaUrl } from '../../src/config/site';

/**
 * The rescued poster frames (Issue #33) are 23 objects in `orthobio-media`
 * under `posters/`, referenced from the year YAML as `/media/posters/<key>`.
 *
 * Why the values are pinned here rather than left to the other suites: the
 * schema only proves a poster path is root-relative or on our own storage, so
 * `/media/posters/yt-typo.webp` satisfies it; the e2e suite asserts geometry
 * and a11y, and the facade reserves its 16/9 box whether the image resolves or
 * not, so a page full of missing posters looks exactly like a page full of
 * present ones. Values belong in unit tests (AGENTS.md, the «фото 12» lesson).
 *
 * Four things are pinned: the shape every poster resolves to, the coverage
 * (23 of 23 videos, per year), the two-way agreement with the manifest, and —
 * the one that catches a SWAP — that each poster key is derived from the id of
 * the video it backs.
 */

const CONGRESS_DIR = fileURLToPath(new URL('../../src/content/congress', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../../docs/assets-manifest.yaml', import.meta.url));

/** Where the bucket lives, spelled out rather than imported — see below. */
const POSTER_URL_PREFIX = 'https://s3.twcstorage.ru/orthobio-media/posters/';

interface Poster {
  url: string;
  width: number;
  height: number;
}

interface Video {
  url: string;
  title: string | null;
  poster: Poster | null;
}

interface Year {
  year: number;
  draft: boolean;
  videos: Video[];
}

const years: Year[] = readdirSync(CONGRESS_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .map((file) => {
    const data = parse(readFileSync(`${CONGRESS_DIR}/${file}`, 'utf8')) as Partial<Year>;
    return {
      year: data.year as number,
      draft: data.draft === true,
      videos: (data.videos ?? []) as Video[],
    };
  });

/** `2099.yaml` is a draft smoke fixture; it is never built, so it is not pinned. */
const published = years.filter((y) => !y.draft).sort((a, b) => a.year - b.year);
const videos = published.flatMap((y) => y.videos.map((v) => ({ ...v, year: y.year })));
const withPoster = videos.filter((v) => v.poster).map((v) => ({ ...v, poster: v.poster as Poster }));

const manifest = parse(readFileSync(MANIFEST, 'utf8')) as {
  video_posters: {
    counters: { videos: number; objects: number; original_bytes: number; object_bytes: number };
    items: {
      id: string;
      year: number;
      video: string;
      source: string;
      s3_key: string;
      s3_status: string;
      original: { bytes: number };
      object: { w: number; h: number; bytes: number };
    }[];
  };
};
const manifestPaths = manifest.video_posters.items.map((i) => `/media/${i.s3_key}`);

/**
 * The poster key is `<provider>-<video id>` — the same derivation
 * `scripts/rescue-video-posters.mjs` writes. Restated here rather than
 * imported: a test that imports the rule under test agrees with whatever the
 * rule currently says, including a broken version of it.
 */
const expectedKey = (videoUrl: string): string => {
  const u = new URL(videoUrl);
  if (u.hostname.endsWith('youtube.com')) return `yt-${u.searchParams.get('v')}`;
  if (u.hostname === 'youtu.be') return `yt-${u.pathname.slice(1)}`;
  return `rt-${u.pathname.split('/').filter(Boolean)[1]}`;
};

describe('every archive video carries a poster on our own storage', () => {
  /** Lowercase prefix, `yt-`/`rt-` and a provider id — the exact key shape. */
  const SHAPE = /^\/media\/posters\/(?:yt|rt)-[A-Za-z0-9_-]+\.webp$/;

  it('covers all 23 videos — none left on the bare dark plate', () => {
    expect(videos).toHaveLength(23);
    expect(withPoster).toHaveLength(23);
  });

  it.each([
    [2021, 3],
    [2022, 8],
    [2023, 5],
    [2024, 4],
    [2025, 3],
    [2026, 0],
  ])('%i has %i videos, each with a poster', (year, count) => {
    const y = published.find((p) => p.year === year);
    expect(y?.videos).toHaveLength(count);
    expect(y?.videos.filter((v) => v.poster)).toHaveLength(count);
  });

  it.each(withPoster.map((v) => [v.poster.url, v] as const))(
    '%s has the shape of a posters/ key',
    (url) => {
      expect(url).toMatch(SHAPE);
    },
  );

  it('maps to the public bucket URL through mediaUrl, with no doubled slash', () => {
    // Asserted against a literal rather than against MEDIA_BASE_URL: importing
    // the constant would make the test agree with a broken constant.
    for (const v of withPoster) {
      const url = mediaUrl(v.poster.url);
      expect(url).toBe(POSTER_URL_PREFIX + v.poster.url.slice('/media/posters/'.length));
      expect(url.slice('https://'.length)).not.toContain('//');
    }
  });

  it('never points a card at a provider CDN — that is the whole issue (ТЗ §4)', () => {
    // The frames were copied into our bucket precisely so no card asks
    // i.ytimg.com or Rutube's CDN for a pixel.
    for (const v of withPoster) expect(v.poster.url).toMatch(/^\/media\/posters\//);
  });
});

describe('the declared dimensions describe the object', () => {
  /**
   * `width`/`height` are what reserves the box before the image arrives, and
   * they are the only place the shape of the object is stated in the data. A
   * poster that is not 16:9 letterboxes itself inside a 16:9 facade under
   * `object-fit: cover` — visible as a crop nobody chose.
   */
  it.each(withPoster.map((v) => [v.poster.url, v.poster] as const))('%s is 16:9', (_url, poster) => {
    expect(poster.width / poster.height).toBeCloseTo(16 / 9, 2);
  });

  it('is never smaller than the card slot it fills', () => {
    // The video grid's column floor is 300px; anything under 480 would be
    // visibly soft on a 2x phone. 21 of 23 are 800 wide — the two exceptions
    // are videos whose provider publishes no larger frame (manifest).
    for (const v of withPoster) expect(v.poster.width).toBeGreaterThanOrEqual(480);
    expect(withPoster.filter((v) => v.poster.width < 800)).toHaveLength(2);
  });

  it('agrees with the manifest object, pixel for pixel', () => {
    const sizeOf = new Map(
      manifest.video_posters.items.map((i) => [`/media/${i.s3_key}`, i.object]),
    );
    for (const v of withPoster) {
      const object = sizeOf.get(v.poster.url);
      expect({ w: v.poster.width, h: v.poster.height }).toEqual({ w: object?.w, h: object?.h });
    }
  });
});

describe('each card wears the poster of its OWN video', () => {
  /**
   * The failure this catches is a SWAP: exchange two poster paths between two
   * cards and every other assertion here still passes — shapes valid, counts
   * unchanged, both keys in the manifest, both 16:9. Only «right video ↔ right
   * frame» is violated, and nothing else in the repo can see it (the same class
   * of miss as the logo-swap check in `partner-logos.test.ts`).
   */
  it.each(withPoster.map((v) => [`${v.year} ${v.url}`, v] as const))(
    '%s',
    (_label, v) => {
      expect(v.poster.url).toBe(`/media/posters/${expectedKey(v.url)}.webp`);
    },
  );

  it('records the same video against that key in the manifest', () => {
    const videoOf = new Map(manifest.video_posters.items.map((i) => [`/media/${i.s3_key}`, i.video]));
    for (const v of withPoster) expect(videoOf.get(v.poster.url)).toBe(v.url);
  });
});

describe('manifest and content agree on what was uploaded', () => {
  it('lists 23 uploaded objects, each key once', () => {
    expect(manifest.video_posters.items).toHaveLength(23);
    expect(manifest.video_posters.counters.objects).toBe(manifest.video_posters.items.length);
    expect(manifest.video_posters.counters.videos).toBe(videos.length);
    expect(new Set(manifestPaths).size).toBe(manifestPaths.length);
    for (const item of manifest.video_posters.items) expect(item.s3_status).toBe('uploaded');
  });

  it('has no content path missing from the manifest — that poster would 404', () => {
    const known = new Set(manifestPaths);
    const phantom = withPoster.filter((v) => !known.has(v.poster.url)).map((v) => v.poster.url);
    expect(phantom).toEqual([]);
  });

  it('has no uploaded object nobody references — that frame would be invisible', () => {
    const referenced = new Set(withPoster.map((v) => v.poster.url));
    expect(manifestPaths.filter((k) => !referenced.has(k))).toEqual([]);
  });

  it('files each poster under the year whose page actually shows it', () => {
    /**
     * `year` is provenance, and provenance is the one field nothing else
     * constrains: an item could say 2023 about a 2022 poster and every other
     * assertion would still pass. This is the «15/16 апреля» trap of ТЗ §3 in
     * its poster form — the manifest's whole job is to be the record that
     * outlives i.ytimg.com, so a wrong year in it is a wrong answer forever.
     */
    const yearOf = new Map(videos.map((v) => [v.url, v.year]));
    for (const item of manifest.video_posters.items) {
      expect(item.year, `${item.id} (${item.video})`).toBe(yearOf.get(item.video));
    }
  });

  it('adds its counters up — they are a summary, not a second opinion', () => {
    const sum = (pick: (i: (typeof manifest.video_posters.items)[number]) => number) =>
      manifest.video_posters.items.reduce((total, i) => total + pick(i), 0);
    expect(manifest.video_posters.counters.object_bytes).toBe(sum((i) => i.object.bytes));
    expect(manifest.video_posters.counters.original_bytes).toBe(sum((i) => i.original.bytes));
  });

  it('records where each frame came from, so the rescue stays auditable', () => {
    // Provenance is the point of the manifest: in a year i.ytimg.com may be
    // unreachable and this line is the only record of what our copy IS.
    for (const item of manifest.video_posters.items) {
      expect(item.source).toMatch(/^https:\/\/(i\.ytimg\.com|pic\.rtbcdn\.ru)\//);
    }
  });
});

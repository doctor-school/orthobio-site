import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { UPCOMING_CONGRESS_VENUE } from '../../src/config/site';

/**
 * The venue card on /registration (Issue #82). The e2e suite measures its
 * geometry; the VALUES it prints — and the provenance of the map it shows —
 * are pinned here, where a wrong one fails by name.
 */

const NBSP = ' ';
const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

interface SiteAsset {
  id: string;
  status: string;
  source: string;
  licence?: string;
  local: string | null;
  coordinates?: { lon: number; lat: number };
  tiles?: { zoom: number; x: [number, number]; y: [number, number] };
  crop?: { left: number; top: number; width: number; height: number };
  retired_by?: number;
  last_commit?: string;
  object: { w: number; h: number; bytes: number; sha256: string };
}

const TILE = 256;

/** Web-Mercator pixel of a coordinate at `zoom` (the OSM tile scheme). */
function worldPixel(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom * TILE;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

const manifest = () =>
  (parse(readFileSync(root('docs/assets-manifest.yaml'), 'utf8')) as { site_assets: { items: SiteAsset[] } })
    .site_assets.items;

describe('venue card', () => {
  it('prints the approved venue facts, typeset by hand', () => {
    expect(UPCOMING_CONGRESS_VENUE.card).toEqual({
      name: 'Отель «Милан»',
      address: `Москва, ул.${NBSP}Шипиловская, 28А`,
      note: `м.${NBSP}«Домодедовская»${NBSP}— 15${NBSP}минут пешком`,
    });
  });

  it('links to the organisation page on Yandex Maps', () => {
    expect(UPCOMING_CONGRESS_VENUE.mapUrl).toBe('https://yandex.ru/maps/org/milan/1088776161/');
  });

  it('shows a self-hosted OpenStreetMap raster that the manifest traces to its source', () => {
    const map = manifest().find(({ id }) => id === 'venue-map');
    expect(map).toBeDefined();
    const bytes = readFileSync(root(map!.local!));
    expect(bytes.length).toBe(map!.object.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(map!.object.sha256);
    // Openly licensed imagery only (PR #87 review: Yandex terms forbid storing
    // a Static API raster), with the credit the licence requires.
    expect(map!.source).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(map!.licence).toMatch(/ODbL/);
    expect(map!.licence).toContain('© участники OpenStreetMap');
    // 2:1, as the card's frame is.
    expect(map!.object.w / map!.object.h).toBe(2);
    expect(map!.crop).toMatchObject({ width: map!.object.w, height: map!.object.h });
  });

  it('is centred on the venue, where the CSS pin sits', () => {
    const map = manifest().find(({ id }) => id === 'venue-map')!;
    const { zoom, x, y } = map.tiles!;
    const centre = worldPixel(map.coordinates!.lon, map.coordinates!.lat, zoom);
    const imageCentre = {
      x: x[0] * TILE + map.crop!.left + map.crop!.width / 2,
      y: y[0] * TILE + map.crop!.top + map.crop!.height / 2,
    };
    expect(Math.abs(imageCentre.x - centre.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(imageCentre.y - centre.y)).toBeLessThanOrEqual(1);
    // …and the stitched tiles cover the crop.
    expect(map.crop!.left + map.crop!.width).toBeLessThanOrEqual((x[1] - x[0] + 1) * TILE);
    expect(map.crop!.top + map.crop!.height).toBeLessThanOrEqual((y[1] - y[0] + 1) * TILE);
  });

  it('keeps the retired owner photo on record, recoverable from git', () => {
    const photo = manifest().find(({ id }) => id === 'venue-hotel-milan');
    expect(photo).toMatchObject({ status: 'retired', retired_by: 82, last_commit: '2151724', local: null });
  });

  it('no longer ships the retired venue photo', () => {
    expect(existsSync(root('src/assets/hotel-milan.webp'))).toBe(false);
  });
});

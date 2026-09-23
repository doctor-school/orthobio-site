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
  source: string;
  local: string;
  coordinates?: { lon: number; lat: number };
  object: { w: number; h: number; bytes: number; sha256: string };
}

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

  it('shows a self-hosted map that the manifest traces to its source', () => {
    const manifest = parse(readFileSync(root('docs/assets-manifest.yaml'), 'utf8')) as {
      site_assets: { items: SiteAsset[] };
    };
    const map = manifest.site_assets.items.find(({ id }) => id === 'venue-map');
    expect(map).toBeDefined();
    const bytes = readFileSync(root(map!.local));
    expect(bytes.length).toBe(map!.object.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(map!.object.sha256);
    // 2:1, as the card's frame is, and centred on the venue — the pin is a CSS
    // overlay at the centre, so a map centred elsewhere would mark the wrong spot.
    expect(map!.object.w / map!.object.h).toBe(2);
    const ll = new URL(map!.source).searchParams.get('ll');
    expect(ll).toBe(`${map!.coordinates!.lon},${map!.coordinates!.lat}`);
  });

  it('no longer ships the retired venue photo', () => {
    expect(existsSync(root('src/assets/hotel-milan.webp'))).toBe(false);
  });
});

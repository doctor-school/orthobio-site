import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

import VideoCard from '../../src/components/VideoCard.astro';

/**
 * The `poster: null` branch of VideoCard (Issue #33 AC: «фолбэк на плашку
 * сохранён»).
 *
 * DELIBERATE EXCEPTION to «unit tests are pure logic, rendering is the e2e
 * suite's job» (vitest.config.ts). The e2e suite renders real routes, and no
 * published year has a poster-less video — 23 of 23 were rescued — so the
 * fallback the issue promises is reachable from no page the suite can visit.
 * It was a claim in a comment and nothing else. Astro's container renders the
 * component directly, which is the only way to put that branch under test
 * without inventing a fake year in the content collection.
 *
 * Scope is exactly the two branches: what markup a poster produces and what its
 * absence produces. Geometry, contrast and the click-to-load island stay with
 * the e2e suite.
 */
const render = (props: Record<string, unknown>) =>
  AstroContainer.create().then((container) => container.renderToString(VideoCard, { props }));

const YOUTUBE = 'https://www.youtube.com/watch?v=c-RvCZ2GPKM';
const RUTUBE = 'https://rutube.ru/video/15094348253029651341d677331f4515/';
const POSTER = { url: '/media/posters/yt-c-RvCZ2GPKM.webp', width: 640, height: 360 };

describe('a card with no poster falls back to the bare plate', () => {
  it('renders no <img> at all — an empty src would be a broken-image icon', async () => {
    const html = await render({ url: YOUTUBE, title: 'Отчётный ролик', year: 2021, poster: null });
    expect(html).not.toContain('ob-vc__poster');
    expect(html).not.toContain('<img');
  });

  it('keeps the facade, the host badge and the play glyph', async () => {
    const html = await render({ url: YOUTUBE, title: 'Отчётный ролик', year: 2021, poster: null });
    // The plate itself is the fallback: its ink background lives on this
    // element, so as long as it is rendered the card has a finished look.
    expect(html).toContain('ob-vc__facade');
    expect(html).toContain('ob-vc__play');
    expect(html).toContain('>YouTube<');
    expect(html).toContain('Отчётный ролик');
  });

  it('is the DEFAULT — omitting the prop must not throw or emit an image', async () => {
    // The schema defaults `poster` to null, and a caller that forgets to pass
    // it through (the year page does) must land on the same fallback.
    const html = await render({ url: RUTUBE, title: null, year: 2025 });
    expect(html).not.toContain('ob-vc__poster');
    // No title either: the card names itself from the year.
    expect(html).toContain('Видео конгресса 2025');
  });
});

describe('a card with a poster paints it inside the facade', () => {
  it('resolves the bucket URL and states the intrinsic size', async () => {
    const html = await render({ url: YOUTUBE, title: 'Отчётный ролик', year: 2021, poster: POSTER });
    expect(html).toContain('src="https://s3.twcstorage.ru/orthobio-media/posters/yt-c-RvCZ2GPKM.webp"');
    expect(html).toContain('width="640"');
    expect(html).toContain('height="360"');
    expect(html).toContain('loading="lazy"');
  });

  it('leaves the alt empty — the caption already names the video', async () => {
    const html = await render({ url: YOUTUBE, title: 'Отчётный ролик', year: 2021, poster: POSTER });
    expect(html).toContain('alt=""');
  });

  it('puts the image BEFORE the host badge, which is what the pill selector needs', async () => {
    // `.ob-vc__facade:has(.ob-vc__poster) .ob-vc__host` no longer depends on the
    // order, but the badge must still sit inside the same facade as the poster.
    const html = await render({ url: RUTUBE, title: 'Отчётный ролик', year: 2025, poster: POSTER });
    expect(html.indexOf('ob-vc__poster')).toBeLessThan(html.indexOf('ob-vc__host'));
  });
});

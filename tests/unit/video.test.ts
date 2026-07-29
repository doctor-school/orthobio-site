import { describe, expect, it } from 'vitest';

import { videoEmbedSrc } from '@/lib/video';
import { ALLOWED_VIDEO_HOSTS } from '@/content/schemas';

/**
 * The click-to-load facade lives or dies by this derivation: a wrong embed URL
 * renders an iframe that shows Rutube's «видео не найдено» instead of the
 * report, and the e2e suite — which asserts geometry, not payloads — would call
 * that a pass. Every shape the archive YAML can hold is pinned here.
 */
describe('videoEmbedSrc', () => {
  it('turns a Rutube watch URL into the player embed', () => {
    expect(videoEmbedSrc('https://rutube.ru/video/938e909c140c9d918077ebcfa366e3d5/')).toBe(
      'https://rutube.ru/play/embed/938e909c140c9d918077ebcfa366e3d5/?autoplay=true',
    );
  });

  it('accepts a watch URL without the trailing slash', () => {
    expect(videoEmbedSrc('https://rutube.ru/video/a050a5bd7bc358faa8cc74b057738053')).toBe(
      'https://rutube.ru/play/embed/a050a5bd7bc358faa8cc74b057738053/?autoplay=true',
    );
  });

  it('ignores tracking query on the watch URL', () => {
    expect(
      videoEmbedSrc('https://rutube.ru/video/15094348253029651341d677331f4515/?r=wd&t=42'),
    ).toBe('https://rutube.ru/play/embed/15094348253029651341d677331f4515/?autoplay=true');
  });

  it('keeps the access token of a link-only («приватное») video', () => {
    expect(
      videoEmbedSrc('https://rutube.ru/video/private/938e909c140c9d918077ebcfa366e3d5/?p=TOKEN1'),
    ).toBe('https://rutube.ru/play/embed/938e909c140c9d918077ebcfa366e3d5/?p=TOKEN1&autoplay=true');
  });

  it('is idempotent on a URL that is already an embed', () => {
    expect(videoEmbedSrc('https://rutube.ru/play/embed/938e909c140c9d918077ebcfa366e3d5/')).toBe(
      'https://rutube.ru/play/embed/938e909c140c9d918077ebcfa366e3d5/?autoplay=true',
    );
  });

  // YouTube stays an outbound link: its player is a lottery from the RF, which
  // is the whole reason the facade exists (AGENTS.md RF-accessibility rule).
  it.each([
    'https://www.youtube.com/watch?v=c-RvCZ2GPKM',
    'https://youtube.com/watch?v=c-RvCZ2GPKM',
    'https://youtu.be/c-RvCZ2GPKM',
  ])('refuses to embed YouTube (%s)', (url) => {
    expect(videoEmbedSrc(url)).toBeNull();
  });

  /**
   * The hostname check here and `ALLOWED_VIDEO_HOSTS` in the content schema are
   * two lists that must agree, with nothing connecting them. Widen the schema
   * to a mirror or `www.rutube.ru` and the YAML validates, the build succeeds,
   * the badge still reads «Rutube» — and the card silently downgrades to an
   * outbound link that nobody is looking at. This is the alarm for that.
   */
  it('embeds every Rutube host the content schema admits', () => {
    const rutubeHosts = ALLOWED_VIDEO_HOSTS.filter((h) => h.includes('rutube'));
    expect(rutubeHosts.length).toBeGreaterThan(0);
    for (const host of rutubeHosts) {
      expect(
        videoEmbedSrc(`https://${host}/video/938e909c140c9d918077ebcfa366e3d5/`),
        `${host} is an allowed video host but yields no embed — the card would ` +
          `render as an outbound link with no error anywhere`,
      ).not.toBeNull();
    }
  });

  it.each([
    ['a Rutube channel page', 'https://rutube.ru/channel/23704195/'],
    ['a Rutube URL with no video id', 'https://rutube.ru/video/'],
    ['an id that is not a Rutube hash', 'https://rutube.ru/video/not-a-video-id/'],
    ['a look-alike host', 'https://rutube.ru.evil.example/video/938e909c140c9d918077ebcfa366e3d5/'],
    ['plain http', 'http://rutube.ru/video/938e909c140c9d918077ebcfa366e3d5/'],
    ['our own storage', '/media/2025/report.mp4'],
    ['nonsense', 'not a url at all'],
  ])('refuses to embed %s', (_case, url) => {
    expect(videoEmbedSrc(url)).toBeNull();
  });
});

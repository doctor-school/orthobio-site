import { test, expect, type Page } from '@playwright/test';
import { measureOverflow, OVERFLOW_WIDTHS, SCROLLBAR_GUTTER } from './_overflow';
import { expectNoColumnOverlap } from './_layout';

/**
 * Click-to-load video facade (design brief §3.5, Issue #19).
 *
 * The provider is stubbed: what is under test is our swap — that the click
 * yields an in-page frame pointed at the right video and never a navigation —
 * and a suite that depends on Rutube being reachable would fail for reasons
 * that have nothing to do with this repo. The stub is installed on the CONTEXT,
 * not the page, so a modified click that opens a second tab is covered too.
 */
const WATCH_URL = 'https://rutube.ru/video/15094348253029651341d677331f4515/';
const EMBED_URL = 'https://rutube.ru/play/embed/15094348253029651341d677331f4515/?autoplay=true';

const stubProvider = (page: Page) =>
  page
    .context()
    .route('https://rutube.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub' }),
    );

test('a Rutube card loads the player in place, without leaving the page', async ({ page }) => {
  await stubProvider(page);
  await page.goto('/archive/2025');

  const facade = page.locator('a[data-ob-video]').first();
  // The name is the card's own text; nothing about it is authored.
  await expect(facade).toHaveAccessibleName(/Отчетный ролик конгресса 2025/);
  // Nothing embedded before the click: eight frames on a year page is the cost
  // the facade exists to avoid.
  await expect(page.locator('iframe')).toHaveCount(0);

  await facade.click();

  const frame = page.locator('iframe.ob-vc__frame');
  await expect(frame).toHaveAttribute('src', EMBED_URL);
  // A frame without a name is an unlabelled region for a screen reader.
  await expect(frame).toHaveAttribute('title', /\S/);
  expect(page.url()).toContain('/archive/2025');
  // The sibling cards are untouched: one click loads one player.
  await expect(page.locator('a[data-ob-video]')).toHaveCount(2);
  // The caption survives the swap — it is moved, not re-rendered.
  await expect(page.locator('.ob-vc__frame + .ob-vc__title')).toHaveText(
    /Отчетный ролик конгресса 2025/,
  );
});

test('the facade is keyboard-operable and keeps focus in the player', async ({ page }) => {
  await stubProvider(page);
  await page.goto('/archive/2025');

  const facade = page.locator('a[data-ob-video]').first();
  await facade.focus();
  await expect(facade).toBeFocused();
  await page.keyboard.press('Enter');

  const frame = page.locator('iframe.ob-vc__frame');
  await expect(frame).toBeAttached();
  // The activated element is gone; without an explicit move, focus falls back
  // to <body> and a keyboard user restarts at the top of the document.
  await expect(frame).toBeFocused();
});

/**
 * Progressive enhancement is the whole point of the anchor: the island may not
 * run (a proxy that strips `type="module"`, an extension, a future
 * `script-src 'self'` CSP), and the video must still be reachable when it does
 * not. This is the regression for the review finding on PR #30.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the card is still a working link to the video', async ({ page }) => {
    await stubProvider(page);
    await page.goto('/archive/2025');

    const card = page.locator('a[data-ob-video]').first();
    await expect(card).toHaveAttribute('href', WATCH_URL);
    await expect(card).toBeVisible();
    // Nothing was swapped in, and nothing pretends it was.
    await expect(page.locator('iframe')).toHaveCount(0);
    // Every video on the page is reachable, not just the first.
    await expect(page.locator('a.ob-vc[href^="https://rutube.ru/video/"]')).toHaveCount(3);

    // «Has an href» is not the claim; «the visitor gets to the video» is.
    // The card carries target="_blank" like every other third-party link on the
    // site (PR #29), so the fallback lands in a new tab and the archive page
    // the reader was on survives.
    const [opened] = await Promise.all([page.waitForEvent('popup'), card.click()]);
    expect(opened.url()).toBe(WATCH_URL);
  });
});

test('a modified click is left to the browser, not swallowed by the island', async ({ page }) => {
  // Ctrl-click, ⌘-click and middle-click are how a physician opens the video in
  // a background tab; an unguarded preventDefault() kills all three silently.
  await stubProvider(page);
  await page.goto('/archive/2025');

  const card = page.locator('a[data-ob-video]').first();
  await card.click({ modifiers: ['ControlOrMeta'] });

  await expect(page.locator('iframe.ob-vc__frame')).toHaveCount(0);
  await expect(page.locator('a[data-ob-video]')).toHaveCount(3);
});

/**
 * The activated card is novel geometry: every other guard in the suite measures
 * /archive/2025 in its facade (pre-click) state, so the frame that replaces the
 * facade had no per-breakpoint regression at all. A 16/9 box dropped into a
 * grid column is exactly the shape that overflows a 360px phone.
 */
test.describe('the loaded player holds the layout', () => {
  for (const width of OVERFLOW_WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      await stubProvider(page);
      await page.setViewportSize({ width: width - SCROLLBAR_GUTTER, height: 900 });
      await page.goto('/archive/2025');

      const before = await measureOverflow(page);
      expect(before, `/archive/2025 already overflows at ${width}px`).toBeLessThanOrEqual(0);

      await page.locator('a[data-ob-video]').first().click();
      const frame = page.locator('iframe.ob-vc__frame');
      await expect(frame).toBeVisible();

      const box = await frame.boundingBox();
      expect(box, 'the loaded frame must have a box').not.toBeNull();
      // The facade reserves 16/9 and the frame must inherit it — a frame that
      // collapses or grows past its column is a layout shift, not a player.
      expect(box!.width / box!.height, `frame aspect ratio at ${width}px`).toBeCloseTo(16 / 9, 2);

      const after = await measureOverflow(page);
      expect(
        after,
        `the loaded player overflows the usable width ${width - SCROLLBAR_GUTTER}px by ${after}px`,
      ).toBeLessThanOrEqual(0);
      await expectNoColumnOverlap(page, `loaded player @${width}`);
    });
  }
});

/**
 * Poster frames (Issue #33). The facade used to be a bare dark plate because
 * hotlinking the providers' CDNs is out; the frames now come from our own
 * bucket. Two claims are load-bearing and only a browser can settle them: the
 * image really decodes (a 404 still occupies its reserved box, so the DOM alone
 * proves nothing), and the page asks NO foreign host for it.
 */
test.describe('poster frames', () => {
  const BUCKET_POSTERS = 'https://s3.twcstorage.ru/orthobio-media/posters/';

  /**
   * A 16×9 WebP, 48 bytes, standing in for the bucket. The suite's claim is
   * about OUR markup — right host, reserved box, no foreign request — and none
   * of that is evidence about Timeweb's uptime. Served locally so the run
   * cannot go red because a bucket in another country hiccuped, or because the
   * runner has no egress to an RU host; the one test that does need the live
   * object says so in its name and skips when the host is unreachable.
   */
  const STUB_WEBP = Buffer.from(
    'UklGRigAAABXRUJQVlA4IBwAAABwAQCdASoQAAkABUB8JZQCdAFAAAD+73QKv0gA',
    'base64',
  );
  const stubBucket = (page: Page) =>
    page.route(`${BUCKET_POSTERS}*`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/webp', body: STUB_WEBP }),
    );

  test('every card paints a poster served from our own bucket', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (r) => {
      const { hostname } = new URL(r.url());
      if (/ytimg|rtbcdn|youtube|rutube/.test(hostname)) foreign.push(r.url());
    });
    await stubBucket(page);

    // 2022 is the densest year: 8 videos, 5 of them behind the disclosure.
    await page.goto('/archive/2022');
    const posters = page.locator('a.ob-vc img.ob-vc__poster');
    await expect(posters).toHaveCount(8);

    for (const src of await posters.evaluateAll((imgs) =>
      imgs.map((i) => (i as HTMLImageElement).getAttribute('src')),
    )) {
      expect(src).toContain(BUCKET_POSTERS);
    }

    // The reserved box: without both attributes the card reflows when the
    // image lands, which is the CLS the facade's 16/9 exists to prevent.
    const first = posters.first();
    await expect(first).toHaveAttribute('width', /^\d+$/);
    await expect(first).toHaveAttribute('height', /^\d+$/);

    // Decodes into a real image — the `src` is wired to an <img> the browser
    // accepts, not merely to a string in the DOM.
    await first.scrollIntoViewIfNeeded();
    await expect
      .poll(() => first.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    // Over a frame the host badge gets its scrim pill, so its contrast stops
    // depending on whatever the photograph shows. The rule is keyed on
    // `:has(.ob-vc__poster)` — a card without a poster must NOT get the pill,
    // and there is no CSS test but this one.
    const badgeBg = await page
      .locator('.ob-vc__host')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(badgeBg).not.toBe('rgba(0, 0, 0, 0)');

    // The whole point of the rescue: not one request leaves for a provider.
    expect(foreign).toEqual([]);
  });

  /**
   * The one assertion that genuinely needs the live bucket, kept separate so a
   * red run names its own cause. A 404 or a truncated object FAILS — that is a
   * broken card. An unreachable host SKIPS: the media host being down (or
   * firewalled off from the runner) is not a defect in the diff under test.
   */
  test('@network the bucket really serves the frame the card points at', async ({
    page,
    request,
  }) => {
    const url = `${BUCKET_POSTERS}rt-15094348253029651341d677331f4515.webp`;
    const probe = await request.get(url, { timeout: 10_000 }).catch(() => null);
    test.skip(probe === null, 'no egress to s3.twcstorage.ru — media uptime is not this suite’s claim');
    expect(probe!.status(), `${url} must be a live public object`).toBe(200);
    expect(probe!.headers()['content-type']).toBe('image/webp');

    await page.goto('/archive/2025');
    const first = page.locator('a.ob-vc img.ob-vc__poster').first();
    await first.scrollIntoViewIfNeeded();
    await expect
      .poll(() => first.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('the dark plate survives underneath as the poster-less fallback', async ({ page }) => {
    // No published year has a poster-less video, so this route cannot show the
    // fallback itself — `poster: null` is rendered and asserted in
    // tests/unit/video-card.test.ts. What THIS proves is the other half: the
    // poster covers the plate rather than replacing it, so a card that has no
    // <img> lands on a plate that is still painted.
    await stubBucket(page);
    await page.goto('/archive/2025');
    const facade = page.locator('.ob-vc__facade').first();
    const bg = await facade.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');

    // The play glyph must stay ON TOP of the poster: it is a positioned
    // element's job to escape a static sibling's stacking, and getting that
    // wrong hides the only affordance the card has.
    const play = page.locator('.ob-vc__play').first();
    await play.scrollIntoViewIfNeeded();
    const box = await play.boundingBox();
    expect(box).not.toBeNull();
    const onTop = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('.ob-vc__play') !== null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    );
    expect(onTop).toBe(true);
  });
});

test('a YouTube card stays an outbound link and says so', async ({ page }) => {
  // 20 of 23 archive videos are YouTube-hosted, which the RF cannot rely on —
  // those cards must not pretend to embed.
  await page.goto('/archive/2021');
  await expect(page.locator('a[data-ob-video]')).toHaveCount(0);

  const card = page.locator('a.ob-vc').first();
  await expect(card).toHaveAttribute('href', /youtube\.com|youtu\.be/);
  await expect(card).toHaveAttribute('target', '_blank');
  await expect(card).toHaveAttribute('rel', /noopener/);
  await expect(card.locator('.ob-vc__ext')).toHaveText(/новой вкладке/);
});

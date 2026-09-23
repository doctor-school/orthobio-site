import { expect, type Page } from '@playwright/test';

/**
 * Wait until the self-hosted Inter faces the page renders have actually landed.
 *
 * Every text measurement in this suite is only meaningful in Inter: the
 * fallback in front of it is a different width on every OS (narrower Segoe UI
 * on Windows, wider DejaVu Sans on the Linux CI runner), and `font-display:
 * swap` paints that fallback until the webfont arrives. `page.goto` does not
 * cover the gap — part of the unicode-range subsets is requested AFTER the load
 * event, so `document.fonts.status` is still `loading` when goto returns. The
 * hero pattern and heading-spill probes measured that fallback and failed on CI
 * only (#94).
 *
 * `document.fonts.ready` alone is not enough either: it resolves at once when
 * nothing is loading YET, i.e. before the first layout has asked for a face.
 * So the faces are derived from the rendered text itself — every (style,
 * weight) Inter is computed for, with the characters it has to draw — and each
 * is loaded explicitly and then checked. A face that failed to load (blocked,
 * 404) fails here with a message naming it, instead of a geometry assertion
 * failing three steps later with a number that points nowhere.
 */
export async function waitForWebfonts(page: Page): Promise<void> {
  const report = await page.evaluate(async () => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const used = new Map<string, Set<string>>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue?.trim();
      const el = node.parentElement;
      if (!text || !el || SKIP.has(el.tagName)) continue;
      const style = getComputedStyle(el);
      if (!/^["']?Inter["']?(,|$)/.test(style.fontFamily)) continue;
      const font = `${style.fontStyle} ${style.fontWeight} 16px Inter`;
      const chars = used.get(font) ?? new Set<string>();
      for (const ch of text) chars.add(ch);
      used.set(font, chars);
    }

    const failed: string[] = [];
    for (const [font, chars] of used) {
      const sample = [...chars].join('');
      // `load` REJECTS when a face's fetch fails; caught so the report names
      // the face instead of surfacing a bare NetworkError.
      const faces = await document.fonts.load(font, sample).catch((e: Error) => e);
      if (faces instanceof Error) {
        failed.push(`${font}: ${faces.message}`);
        continue;
      }
      const notLoaded = faces.filter((f) => f.status !== 'loaded');
      if (faces.length === 0 || notLoaded.length > 0 || !document.fonts.check(font, sample)) {
        failed.push(`${font} (${faces.length} faces, ${notLoaded.length} not loaded)`);
      }
    }
    await document.fonts.ready;
    return { status: document.fonts.status, used: [...used.keys()], failed };
  });

  expect(report.used.length, 'the page renders no text in Inter — nothing to wait for').toBeGreaterThan(0);
  expect(report.failed, `Inter faces the page renders did not load: ${report.failed.join('; ')}`).toEqual([]);
  expect(report.status, 'document.fonts is still loading after every used face resolved').toBe('loaded');
}

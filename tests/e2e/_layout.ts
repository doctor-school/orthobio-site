import { expect, type Page } from '@playwright/test';

/**
 * Layout-integrity probes that the overflow guard structurally CANNOT see.
 *
 * `overflow-wrap: break-word` is mandatory on display headings (AGENTS.md), and
 * it keeps `scrollWidth` clean by hard-breaking a word that does not fit — so an
 * overflow check stays green while the headline reads «ОРТОБИОЛОГИ / Я». The
 * responsive-audit found exactly that on the home hero at 360px. Hence two
 * extra assertions, both required by AGENTS.md «no heading spill, no column
 * overlap».
 */

/** Headings must not spill, and no single word may be wider than its column. */
export async function expectNoHeadingSpill(page: Page, path: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const bad: { tag: string; text: string; word: string; wordWidth: number; box: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('h1, h2, h3')) {
      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 60) ?? '',
          word: '(spill)',
          wordWidth: el.scrollWidth,
          box: el.clientWidth,
        });
        continue;
      }
      // A word too wide for its column is hard-broken by `overflow-wrap`, which
      // leaves `scrollWidth` clean — so width alone proves nothing. What betrays
      // the break is the word occupying TWO line boxes: a Range over it then
      // returns two non-zero-width client rects. Chunks are split on characters
      // that are legitimate break opportunities (spaces, hyphens, dashes,
      // slashes, «·»), so a wrap at a hyphen is not reported.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let node: Node | null = walker.nextNode();
      while (node) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/[^\s \-‐-―/·]+/g)) {
          const start = match.index;
          range.setStart(node, start);
          range.setEnd(node, start + match[0].length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          if (rects.length > 1) {
            bad.push({
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 60) ?? '',
              word: match[0],
              wordWidth: Math.round(rects.reduce((sum, r) => sum + r.width, 0)),
              box: el.clientWidth,
            });
          }
        }
        node = walker.nextNode();
      }
    }
    return bad;
  });

  expect(offenders, `heading spill / unbreakable word on ${path}: ${JSON.stringify(offenders)}`).toEqual(
    [],
  );
}

/**
 * No two siblings of ANY grid/flex container may overlap.
 *
 * The container list used to be hardcoded, which meant a new grid component got
 * coverage only if someone remembered to extend it — and forgetting was
 * invisible, because the test stayed green (PR #14 review). The sweep is now
 * generic: every element whose COMPUTED display is grid/flex is checked, so new
 * components are covered the moment they render.
 *
 * Out-of-flow children (`position: absolute/fixed`) are excluded by design —
 * they are deliberately layered (the video facade's host badge over its play
 * button, the hero's background pattern), and flagging them would report the
 * design as a defect.
 */
export async function expectNoColumnOverlap(page: Page, path: string): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const isLayout = (el: Element) => {
      const display = getComputedStyle(el).display;
      return display === 'grid' || display === 'flex';
    };
    const containers = [...document.querySelectorAll<HTMLElement>('body *')].filter(isLayout);
    const found: { container: string; a: string; b: string }[] = [];
    for (const container of containers) {
      const children = [...container.children]
        .filter((c) => {
          const style = getComputedStyle(c);
          // Out-of-flow children are layered on purpose; zero-size ones cannot
          // overlap anything meaningfully.
          if (style.position === 'absolute' || style.position === 'fixed') return false;
          const box = c.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((c) => ({ el: c, box: c.getBoundingClientRect() }));
      for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
          const a = children[i].box;
          const b = children[j].box;
          const overlap =
            a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          if (overlap) {
            found.push({
              container: container.className,
              a: children[i].el.textContent?.trim().slice(0, 30) ?? '',
              b: children[j].el.textContent?.trim().slice(0, 30) ?? '',
            });
          }
        }
      }
    }
    return found;
  });

  expect(overlaps, `overlapping grid items on ${path}: ${JSON.stringify(overlaps)}`).toEqual([]);
}

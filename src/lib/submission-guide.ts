import { segment } from './accommodation';

/**
 * «Как подать материалы» on /participants (Issue #99) — where the section
 * lives. The anchor is PERMANENT: the letter to already registered
 * participants (sent from the DS Platform) links to it, so it is not derived
 * from the heading and must not change with the copy.
 */
export const SUBMISSION_GUIDE_ANCHOR = 'podat-materialy';

export const SUBMISSION_GUIDE_HREF = `/participants#${SUBMISSION_GUIDE_ANCHOR}`;

/**
 * «Как заполнить заявку» (owner, 2026-10-07): the cabinet steps on a page of
 * their own, apart from the sign-in, so a reader who signed in by one route —
 * the success card's personal button or the guide on /participants — never
 * scrolls past the sign-in again. Both routes end with a link to this page.
 * Its block keeps the anchor, so the step ids stay `zapolnit-zayavku-<n>`.
 */
export const FILL_GUIDE_ANCHOR = 'zapolnit-zayavku';

export const FILL_GUIDE_PATH = `/participants/${FILL_GUIDE_ANCHOR}`;

/**
 * The guide used to sit at /participants#zapolnit-zayavku. The fragment never
 * reaches the server, so only the page itself can send such a link on — this
 * script, inlined on /participants, does, step anchors included.
 */
export const FILL_GUIDE_REDIRECT_SCRIPT = `var m = /^#${FILL_GUIDE_ANCHOR}(-\\d+)?$/.exec(location.hash);
if (m) location.replace(${JSON.stringify(FILL_GUIDE_PATH)} + (m[1] ? ${JSON.stringify(`#${FILL_GUIDE_ANCHOR}`)} + m[1] : ''));`;

/** The two guide blocks, each at its own fixed anchor. */
export const GUIDE_ANCHORS = [SUBMISSION_GUIDE_ANCHOR, FILL_GUIDE_ANCHOR] as const;

export type GuideAnchor = (typeof GUIDE_ANCHORS)[number];

/** Id of the n-th step (1-based) of a guide, so a reply can point at one step. */
export const guideStepId = (anchor: GuideAnchor, n: number): string => `${anchor}-${n}`;

/** A piece of a guide sentence as the page prints it. */
export type GuidePart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'ui'; text: string };

/**
 * Splits outermost «…» spans off a piece of running text. Typograf turns
 * quotes inside quotes into „…“, but a hand-typed «…«…»…» stays as it is, so
 * the depth is counted rather than the first «…» taken.
 */
function splitUiLabels(text: string): GuidePart[] {
  const out: GuidePart[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '«') {
      if (depth === 0) {
        if (i > start) out.push({ kind: 'text', text: text.slice(start, i) });
        start = i;
      }
      depth++;
    } else if (text[i] === '»' && depth > 0) {
      depth--;
      if (depth === 0) {
        out.push({ kind: 'ui', text: text.slice(start, i + 1) });
        start = i + 1;
      }
    }
  }
  // An unclosed «: the rest is running text, never a half-marked label.
  if (start < text.length) {
    const prev = out.at(-1);
    if (prev?.kind === 'text') prev.text += text.slice(start);
    else out.push({ kind: 'text', text: text.slice(start) });
  }
  return out;
}

/**
 * The inline marks of a guide sentence (owner, 2026-10-08: «инструкции тяжело
 * читать»). The copy stays plain text (loader-swap invariant); two marks are
 * derived from it here:
 *
 * - a named phrase of the sentence (`links[].text`) is a link — every phrase
 *   must occur, or this throws and the build fails (`segment()`);
 * - every other «…» names an element of the cabinet — a button, field, status
 *   or letter subject — and prints in the one UI-label style, so a reader
 *   scanning for «Отправить» finds it. In a guide, guillemets are reserved
 *   for that; a phrase that is not an interface element is not quoted.
 */
export function guideInline(text: string, links: readonly { text: string; href: string }[] = []): GuidePart[] {
  const hrefs = new Map(links.map((l) => [l.text, l.href]));
  return segment(text, [...hrefs.keys()]).flatMap((s): GuidePart[] =>
    s.mark === null ? splitUiLabels(s.text) : [{ kind: 'link', text: s.text, href: hrefs.get(s.mark)! }],
  );
}

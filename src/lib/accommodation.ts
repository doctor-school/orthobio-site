/**
 * Accommodation section of /participants (Issue #112) — the pure logic behind
 * the «Проживание» block: where the section lives, how a printed phone becomes
 * a dialable `tel:` link, and how plain-text copy gets its inline marks (the
 * promo code in bold, an e-mail as a link) without the content ever carrying
 * markup (loader-swap invariant, AGENTS.md).
 */

/** Fragment id of the section; the /registration venue card links to it. */
export const ACCOMMODATION_ANCHOR = 'accommodation';

export const ACCOMMODATION_HREF = `/participants#${ACCOMMODATION_ANCHOR}`;

/**
 * «+7 (495) 648-93-00» → «tel:+74956489300».
 *
 * A number printed without the country code would dial wrong from a foreign
 * SIM, so only the international form is accepted: anything else is a content
 * error and fails the build rather than ship a link that reaches nobody.
 */
export function telHref(printed: string): string {
  const digits = printed.replace(/\D/g, '');
  if (!printed.trimStart().startsWith('+') || digits.length < 7 || digits.length > 15) {
    throw new Error(`phone «${printed}» must be printed in the international form, e.g. +7 (495) 000-00-00`);
  }
  return `tel:+${digits}`;
}

/**
 * «Забронировать на сайте отеля» → { head: 'Забронировать на сайте ', last:
 * 'отеля' }. A trailing icon is bound to `last` in a no-wrap span, so it can
 * never be left alone on a line or drift away from the text it belongs to.
 * The separator stays in `head` (an ordinary space or Typograf's U+00A0).
 */
export function splitLastWord(text: string): { head: string; last: string } {
  const trimmed = text.trimEnd();
  const m = /^(.*\s)(\S+)$/su.exec(trimmed);
  return m ? { head: m[1], last: m[2] } : { head: '', last: trimmed };
}

export interface Segment {
  text: string;
  /** The needle this piece matched; `null` for the running text between. */
  mark: string | null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits `text` around every occurrence of the given needles.
 *
 * Matches whole words only (see the pattern below). Whitespace-insensitive on
 * purpose: the copy has been through Typograf, which may have turned an
 * ordinary space inside the needle into U+00A0 («в отеле «Милан»»), while the
 * needle itself was typeset in a different context. The
 * returned piece keeps the text as the page prints it.
 *
 * By default every needle must occur at least once. A needle that is missing
 * means the copy and the field that names its emphasis have drifted apart —
 * the bold or the link would silently vanish, so this throws and the build
 * fails. `required: false` is for lists where only some items name the fact.
 */
export function segment(
  text: string,
  needles: readonly string[],
  { required = true }: { required?: boolean } = {},
): Segment[] {
  const wanted = needles.filter((n) => n.trim() !== '');
  if (wanted.length === 0) return [{ text, mark: null }];

  const sources = wanted.map((n) =>
    n
      .trim()
      .split(/\s+/)
      .map(escapeRegExp)
      .join('\\s+'),
  );
  // Longest first, so a needle that contains another wins the overlap.
  const order = wanted
    .map((needle, i) => ({ needle, source: sources[i] }))
    .sort((a, b) => b.needle.length - a.needle.length);
  // Whole words only: the promo code ОРТОБИОЛОГИЯ is also the head of the
  // congress name ОРТОБИОЛОГИЯ-2027, which must neither satisfy the drift check
  // nor render half-bold. A hyphen joins a compound, so it counts as a letter.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}-])(?:${order.map((o) => `(${o.source})`).join('|')})(?![\\p{L}\\p{N}-])`,
    'gu',
  );

  const out: Segment[] = [];
  const seen = new Set<string>();
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index;
    if (at > last) out.push({ text: text.slice(last, at), mark: null });
    const group = m.slice(1).findIndex((g) => g !== undefined);
    const needle = order[group].needle;
    seen.add(needle);
    out.push({ text: m[0], mark: needle });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: null });

  const missing = wanted.filter((n) => !seen.has(n));
  if (required && missing.length > 0) {
    throw new Error(`«${text}» does not contain ${missing.map((n) => `«${n}»`).join(', ')}`);
  }
  return out;
}

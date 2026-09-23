/**
 * Pure logic of the sign-up form's combobox (Issue #88, design `Combo`):
 * which options a typed query keeps, where the typed part sits in an option
 * for the bold highlight, and how the arrow keys move the active option.
 *
 * The list only SUGGESTS. What an entry resolves to — and the «only from the
 * list» rule for specialties — stays with `lib/specialty.ts` and
 * `lib/settlements.ts`, so the combobox can never widen what the form accepts.
 */

/**
 * Case and ё folded, one character for one character: an index found in the
 * folded text is an index into the original, so the highlight keeps the
 * option's own spelling («Щёлково», not «щелково»).
 */
export function foldCase(value: string): string {
  return value.toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

/** The query as it is compared: folded, trimmed, inner spacing collapsed. */
function foldQuery(query: string): string {
  return foldCase(query).trim().replace(/\s+/g, ' ');
}

export interface FilterOptions<T> {
  /** The text an option is matched on (and shown with). */
  text: (option: T) => string;
  /**
   * Applied to the folded query before matching, e.g. the settlement field
   * dropping a typed «г. ». Must not change the folded option texts' alphabet.
   */
  normalise?: (foldedQuery: string) => string;
  /** At most this many options; the directory has thousands. */
  limit?: number;
  /**
   * Only options that START with the query. Places are typed from their first
   * letter, and a foreign «Минск» must not surface «Наро-Фоминск» — an open
   * list over the next field would turn a click there into a wrong pick.
   */
  prefixOnly?: boolean;
}

/**
 * Options whose text contains the query; those that START with it come first
 * (typing «бор» wants «Бор» before «Выборг»). Stable inside both groups, so
 * the source order — alphabetical in both lists — survives.
 */
export function filterOptions<T>(
  options: readonly T[],
  query: string,
  { text, normalise = (q) => q, limit = Infinity, prefixOnly = false }: FilterOptions<T>,
): T[] {
  const needle = normalise(foldQuery(query));
  if (needle === '') return options.slice(0, limit);
  const starts: T[] = [];
  const contains: T[] = [];
  for (const option of options) {
    const at = foldCase(text(option)).indexOf(needle);
    if (at === 0) starts.push(option);
    else if (at > 0 && !prefixOnly) contains.push(option);
  }
  return [...starts, ...contains].slice(0, limit);
}

export interface Highlight {
  before: string;
  match: string;
  after: string;
}

/**
 * The option's text around the typed part, or null when it holds none.
 * `normalise` is the same one `filterOptions` got, so what was matched is
 * what is bold.
 */
export function splitHighlight(
  text: string,
  query: string,
  normalise: (foldedQuery: string) => string = (q) => q,
): Highlight | null {
  const needle = normalise(foldQuery(query));
  if (needle === '') return null;
  const at = foldCase(text).indexOf(needle);
  if (at < 0) return null;
  const end = at + needle.length;
  return { before: text.slice(0, at), match: text.slice(at, end), after: text.slice(end) };
}

/**
 * The active option after an arrow key: one step, clamped to the list (no
 * wrap — the pinned «Другое» is the floor of the specialty list). From «no
 * active option» (-1) either arrow enters at the first one; an empty list has
 * none.
 */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return 0;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

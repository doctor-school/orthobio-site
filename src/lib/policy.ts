/**
 * Renders the owner's privacy policy text (Issue #78) WITHOUT altering it.
 *
 * The consent version id the platform stamps on every acceptance is
 * `<publication date>.sha256-<hash of the LF-normalised text>` (044 EARS-9,
 * ADR-0009 §2.1). The site therefore publishes the text byte-for-byte —
 * `src/content/legal/privacy-policy.txt` is the artefact whose hash the owner
 * recorded, and `tests/unit/privacy-policy.test.ts` pins it. Nothing here goes
 * through the typographer: «ёлочки» or an em dash added by `prose()` would
 * change the hash and silently invalidate every recorded consent.
 *
 * Structure is INFERRED for markup only: a numbered top-level line («1. Общие
 * положения») becomes a section heading, everything else a paragraph. Lines
 * are trimmed (HTML would collapse that whitespace anyway) — their words never
 * change.
 */

export interface PolicySection {
  /** `null` for a preamble before the first numbered heading. */
  heading: string | null;
  paragraphs: string[];
}

export interface PolicyDocument {
  title: string;
  sections: PolicySection[];
}

/**
 * «1. Общие положения» — one number, a dot, whitespace, then a capital letter.
 * A clause such as «1.1. Оператор…» has a digit after the first dot and so is
 * a paragraph, not a heading.
 */
const SECTION_HEADING = /^\d+\.\s+\p{Lu}/u;

export function parsePolicy(text: string): PolicyDocument {
  // Splitting on LF and trimming also drops a CR, so CRLF input parses the same.
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const [title = '', ...body] = lines;

  const sections: PolicySection[] = [];
  let current: PolicySection | null = null;
  for (const line of body) {
    if (SECTION_HEADING.test(line)) {
      current = { heading: line, paragraphs: [] };
      sections.push(current);
      continue;
    }
    if (current === null) {
      current = { heading: null, paragraphs: [] };
      sections.push(current);
    }
    current.paragraphs.push(line);
  }
  return { title, sections };
}

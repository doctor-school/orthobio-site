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
 * положения») becomes a section heading, everything else a paragraph.
 */

export interface PolicySection {
  /** `null` for the preamble before the first numbered heading. */
  heading: string | null;
  paragraphs: string[];
}

export interface PolicyDocument {
  title: string;
  sections: PolicySection[];
}

/** «1. Общие положения» — a single number, a dot, then a capital letter. */
const SECTION_HEADING = /^\d+\.\s+\p{Lu}/u;

export function parsePolicy(text: string): PolicyDocument {
  const lines = text.split('\n').map((l) => l.trim());
  const [title = '', ...rest] = lines.filter((l, i) => i === 0 || true);
  const sections: PolicySection[] = [];
  let current: PolicySection = { heading: null, paragraphs: [] };
  for (const line of rest) {
    if (line === '') continue;
    if (SECTION_HEADING.test(line)) {
      if (current.heading !== null || current.paragraphs.length > 0) sections.push(current);
      current = { heading: line, paragraphs: [] };
    } else {
      current.paragraphs.push(line);
    }
  }
  if (current.heading !== null || current.paragraphs.length > 0) sections.push(current);
  return { title, sections };
}

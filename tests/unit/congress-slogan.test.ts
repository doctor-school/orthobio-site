import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { FOOTER } from '../../src/config/site';
import { typographize } from '../../src/content/typographize';

/**
 * The congress slogan is published TWICE — in the footer of every page and as
 * the overline above the home page <h1> — from two files that are typographed
 * by different mechanisms:
 *
 *   • `content/pages/home.yaml` is content: plain text, run through
 *     `typographize()` at the schema boundary (AGENTS.md, loader-swap invariant);
 *   • `config/site.ts` is config: it never meets `prose()`, so its typography is
 *     authored by hand.
 *
 * The typographer inserts characters that are invisible in a diff and in an
 * editor — the slogan of Issue #74 carried a NON-BREAKING space before its em
 * dash — so the two copies cannot be kept identical by reading them: one plain
 * space in the config and the footer silently wraps where the home page does
 * not. The current slogan (Issue #121) has no such character; the comparison of
 * rendered forms stays so the next one cannot drift unnoticed.
 */
const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('congress slogan', () => {
  it('publishes the owner-approved slogan', () => {
    expect(FOOTER.slogan).toBe('Навстречу новой специальности!');
  });

  it('renders the identical string in the footer and above the home heading', () => {
    const home = parse(source('src/content/pages/home.yaml')) as { overline: string };

    expect(typographize(home.overline)).toBe(FOOTER.slogan);
  });

  it('leaves the 2026 archive under the slogan that congress actually carried', () => {
    // The new slogan belongs to the UPCOMING congress. Rewriting the archive
    // would restate a past event under a name it never had.
    const y2026 = parse(source('src/content/congress/2026.yaml')) as { title: string };

    expect(y2026.title).toContain('Будущее начинается здесь');
  });
});

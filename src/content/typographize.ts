/**
 * Build-time Russian typographer for the Content Layer.
 *
 * Ported from `bbm-public-website/src/content/typographize.ts` (ecosystem
 * donor, its issue #57). Canonical content stays plain text (the loader-swap
 * invariant — the future Doctor.School «конструктор мероприятий» module stores
 * plain text, the site normalizes typography at build). This module is the
 * single seam where that normalization happens: `schemas.ts` wires
 * `.transform(typographize)` onto the explicitly enumerated PROSE fields only,
 * so every consumer/component stays dumb and can never forget to apply it.
 *
 * ── Unicode output, NOT html entities ────────────────────────────────────────
 * `htmlEntity.type: 'default'` makes Typograf emit real Unicode characters
 * (U+00A0 nbsp, «» ёлочки, — em dash, … ellipsis), NOT `&nbsp;`/`&laquo;`
 * named/numeric entities. This is load-bearing: the transformed strings render
 * in BOTH `.astro` text nodes AND HTML attributes (e.g. `title=`, `aria-label=`,
 * `alt=`) without producing visible `&nbsp;` or double-encoding. Astro escapes
 * the real `&`/`<`/`>` it needs to; a literal U+00A0 passes through verbatim and
 * displays as a non-breaking space, never as the text "&nbsp;".
 *
 * `onlyInvisible: false` lets the visible-character rules (quotes, dashes) run;
 * `type: 'default'` still keeps their OUTPUT as Unicode glyphs.
 *
 * The singleton is module-scoped so the rule set is compiled once per build.
 * `typographize` is a pure, idempotent, no-op-safe wrapper: empty string in →
 * empty string out, and running it twice equals running it once (Typograf's
 * rules are themselves idempotent on already-typographed text).
 */

import Typograf from 'typograf';

// `locale: ['ru', 'en-US']` — primary RU rules with en-US as the secondary
// locale so embedded Latin fragments (product names, units) are handled sanely
// rather than mangled. Unicode output (see file header) keeps results safe in
// both text nodes and attributes.
const typograf = new Typograf({
  locale: ['ru', 'en-US'],
  htmlEntity: { type: 'default', onlyInvisible: false },
});

// `common/nbsp/afterNumber` is OFF in Typograf's default set; enable it so
// «число + единица» (34 сессии, 6 баллов, 123 стр.) gets a non-breaking space.
// Safe here because verbatim-sensitive tokens (URLs, paths, tiers, names) are
// NOT routed through this transform; only prose is.
typograf.enableRule('common/nbsp/afterNumber');

/**
 * Apply the configured RU typographer to a prose string.
 *
 * Pure and idempotent. An empty string short-circuits to avoid any rule that
 * could introduce stray whitespace into deliberately-empty content.
 */
export function typographize(s: string): string {
  if (s === '') return '';
  return typograf.execute(s);
}

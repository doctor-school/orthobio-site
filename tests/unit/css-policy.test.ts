import { describe, expect, it } from 'vitest';

import {
  checkCssPolicy,
  lintCssSource,
  lintMarkupSource,
} from '../../scripts/check-css-policy.ts';

describe('CSS token policy', () => {
  it('allows raw design values only in the token source', () => {
    expect(
      lintCssSource(':root { --example: 10px; --brand: #ffffff; }', {
        file: 'src/styles/tokens.css',
      }),
    ).toEqual([]);
  });

  it('rejects fixed lengths and colours outside the token source', () => {
    const violations = lintCssSource(
      [
        '.example {',
        '  padding: 10px;',
        '  color: #ffffff;',
        '  background: rgb(255 255 255);',
        '  border-color: red;',
        '}',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'literal-size', line: 2 },
      { rule: 'literal-color', line: 3 },
      { rule: 'literal-color', line: 4 },
      { rule: 'literal-color', line: 5 },
    ]);
  });

  it('allows contextual ratios and colours assembled from tokens', () => {
    const violations = lintCssSource(
      [
        '.example {',
        '  width: 100%;',
        '  grid-template-columns: minmax(0, 1fr);',
        '  aspect-ratio: 16 / 9;',
        '  color: currentColor;',
        '  border: var(--border-thin) solid var(--border-card);',
        '  background: color-mix(in oklab, var(--ink) 32%, var(--bg));',
        '}',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations).toEqual([]);
  });

  it('permits only mobile-first canonical width breakpoints', () => {
    const canonical = [640, 768, 1024, 1280, 1536]
      .map((width) => `@media (min-width: ${width}px) { .x { display: block; } }`)
      .join('\n');

    expect(
      lintCssSource(canonical, { file: 'src/styles/components.css' }),
    ).toEqual([]);

    const violations = lintCssSource(
      [
        '@media (min-width: 900px) { .x { display: block; } }',
        '@media (max-width: 768px) { .x { display: none; } }',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'ad-hoc-breakpoint', line: 1 },
      { rule: 'desktop-first-breakpoint', line: 2 },
    ]);
  });

  it('rejects inline styles and policy bypasses in Astro style blocks', () => {
    const violations = lintMarkupSource(
      [
        '<div style="padding: 10px">Content</div>',
        '<style>',
        '  .local { margin: 12px; }',
        '</style>',
      ].join('\n'),
      { file: 'src/pages/example.astro' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'inline-style', line: 1 },
      { rule: 'literal-size', line: 3 },
    ]);
  });

  it('keeps the repository compliant', async () => {
    expect(await checkCssPolicy()).toEqual([]);
  });
});

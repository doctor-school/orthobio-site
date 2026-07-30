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

  it('rejects every CSS length-unit family outside the token source', () => {
    const units = [
      'px',
      'em',
      'rem',
      'ch',
      'rch',
      'cap',
      'rcap',
      'ic',
      'ric',
      'lh',
      'rlh',
      'vw',
      'dvw',
      'svw',
      'lvw',
      'vh',
      'dvh',
      'svh',
      'lvh',
      'vi',
      'dvi',
      'svi',
      'lvi',
      'vb',
      'dvb',
      'svb',
      'lvb',
      'vmin',
      'dvmin',
      'svmin',
      'lvmin',
      'vmax',
      'dvmax',
      'svmax',
      'lvmax',
      'cqw',
      'cqh',
      'cqi',
      'cqb',
      'cqmin',
      'cqmax',
      'cm',
      'mm',
      'q',
      'in',
      'pt',
      'pc',
    ];
    const source = units
      .map((unit, index) => `.u-${index} { width: 10${unit}; }`)
      .join('\n');

    expect(
      lintCssSource(source, { file: 'src/styles/components.css' }).map(
        ({ rule, line }) => ({ rule, line }),
      ),
    ).toEqual(
      units.map((_, index) => ({
        rule: 'literal-size',
        line: index + 1,
      })),
    );
  });

  it('finds named colours by value without treating strings as colours', () => {
    const violations = lintCssSource(
      [
        '.example {',
        '  background-image: linear-gradient(red, blue);',
        '  filter: drop-shadow(0 0 var(--sp-1) red);',
        '  stop-color: rebeccapurple;',
        '  content: "#fff red";',
        '  --animation-name: fade;',
        '}',
        '@property --accent {',
        '  syntax: "<color>";',
        '  inherits: false;',
        '  initial-value: red;',
        '}',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'literal-color', line: 2 },
      { rule: 'literal-color', line: 3 },
      { rule: 'literal-color', line: 4 },
      { rule: 'literal-color', line: 11 },
    ]);
  });

  it('finds named colours in image-producing functions on any property', () => {
    const violations = lintCssSource(
      [
        '.example {',
        '  mask-image: linear-gradient(red, blue);',
        '  list-style-image: radial-gradient(white, black);',
        '  content: linear-gradient(gold, transparent);',
        '  shape-outside: conic-gradient(cyan, navy);',
        '}',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'literal-color', line: 2 },
      { rule: 'literal-color', line: 3 },
      { rule: 'literal-color', line: 4 },
      { rule: 'literal-color', line: 5 },
    ]);
  });

  it('grants raw-value access only to the exact token source', () => {
    expect(
      lintCssSource('.example { width: 10px; color: red; }', {
        file: 'fixtures/src/styles/tokens.css',
      }).map(({ rule }) => rule),
    ).toEqual(['literal-size', 'literal-color']);
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
        '  color: rgb(from var(--brand) r g b / 50%);',
        '}',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations).toEqual([]);
  });

  it('permits only mobile-first canonical width breakpoints', () => {
    const canonical = [640, 768, 1024, 1280, 1536]
      .flatMap((width) => [
        `@media (min-width: ${width}px) { .x { display: block; } }`,
        `@container (min-width: ${width}px) { .x { display: block; } }`,
        `@import url("not-width.css") screen and (min-width: ${width}px);`,
      ])
      .join('\n');

    expect(
      lintCssSource(canonical, { file: 'src/styles/components.css' }),
    ).toEqual([]);

    const violations = lintCssSource(
      [
        '@media (min-width: 900px) { .x { display: block; } }',
        '@media (max-width: 768px) { .x { display: none; } }',
        '@media not all and (min-width: 640px) { .x { display: none; } }',
        '@import url("legacy.css") screen and (max-width: 900px);',
        '@container (min-width: 900px) { .x { display: block; } }',
        '@media (width >= 640px) { .x { display: block; } }',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'ad-hoc-breakpoint', line: 1 },
      { rule: 'desktop-first-breakpoint', line: 2 },
      { rule: 'desktop-first-breakpoint', line: 3 },
      { rule: 'desktop-first-breakpoint', line: 4 },
      { rule: 'ad-hoc-breakpoint', line: 5 },
      { rule: 'ad-hoc-breakpoint', line: 6 },
    ]);
  });

  it('parses negated, ranged, aliased, and import width queries structurally', () => {
    const violations = lintCssSource(
      [
        '@media (not (min-width: 640px)) { .x { display: none; } }',
        '@container (not (min-width: 640px)) { .x { display: none; } }',
        '@custom-media --wide (min-width: 640px);',
        '@custom-media --small not (--wide);',
        '@media (--small) { .x { display: none; } }',
        '@container (inline-size > 900px) { .x { display: none; } }',
        '@import url("x.css") supports((width: 1px));',
      ].join('\n'),
      { file: 'src/styles/components.css' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'desktop-first-breakpoint', line: 1 },
      { rule: 'desktop-first-breakpoint', line: 2 },
      { rule: 'ad-hoc-breakpoint', line: 3 },
      { rule: 'ad-hoc-breakpoint', line: 4 },
      { rule: 'ad-hoc-breakpoint', line: 5 },
      { rule: 'ad-hoc-breakpoint', line: 6 },
    ]);
  });

  it('rejects style-bearing Astro syntax using the Astro parser', async () => {
    const violations = await lintMarkupSource(
      [
        '<div title="1 > 0" style="padding: 10px">Content</div>',
        '<div title="1 > 0" style:list={{ color: "red" }}>List</div>',
        '<div title="1 > 0" {...props}>Spread</div>',
        '<style>',
        '  .local { margin: 12px; }',
        '</style>',
        '<style set:html={dynamicCss}></style>',
        '<style>{dynamicCss}</style>',
        '<style {...styleProps} />',
      ].join('\n'),
      { file: 'src/pages/example.astro' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'inline-style', line: 1 },
      { rule: 'inline-style', line: 2 },
      { rule: 'inline-style', line: 3 },
      { rule: 'literal-size', line: 5 },
      { rule: 'dynamic-style', line: 7 },
      { rule: 'dynamic-style', line: 8 },
      { rule: 'dynamic-style', line: 9 },
    ]);
  });

  it('rejects style-bearing HTML syntax using the HTML parser', async () => {
    const violations = await lintMarkupSource(
      [
        '<div title="1 > 0" style="padding: 10px">Content</div>',
        '<style>',
        '  .local { margin: 12px; }',
        '</style>',
      ].join('\n'),
      { file: 'src/pages/example.html' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'inline-style', line: 1 },
      { rule: 'literal-size', line: 3 },
    ]);
  });

  it.each(['jsx', 'tsx'])(
    'rejects style-bearing JSX syntax in .%s files without scanning strings or comments',
    async (extension) => {
      const violations = await lintMarkupSource(
        [
          'const ignored = `<div style="padding: 10px">String</div>`;',
          'export const Example = () => <>',
          '  {/* <div style="padding: 10px">Comment</div> */}',
          '  <div title="1 > 0" style={{ padding: token }}>Content</div>',
          '  <div title="1 > 0" {...props}>Spread</div>',
          '  <style>{dynamicCss}</style>',
          '  <style children={dynamicCss} />',
          '  <style dangerouslySetInnerHTML={{ __html: dynamicCss }} />',
          '</>;',
        ].join('\n'),
        { file: `src/pages/example.${extension}` },
      );

      expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
        { rule: 'inline-style', line: 4 },
        { rule: 'inline-style', line: 5 },
        { rule: 'dynamic-style', line: 6 },
        { rule: 'dynamic-style', line: 7 },
        { rule: 'dynamic-style', line: 8 },
      ]);
    },
  );

  it('rejects Astro style:list directives', async () => {
    const violations = await lintMarkupSource(
      '<div style:list={{ color: "red" }}>Content</div>',
      { file: 'src/pages/example.astro' },
    );

    expect(violations.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'inline-style', line: 1 },
    ]);
  });

  it('does not confuse an object spread inside an explicit prop with an attribute spread', async () => {
    expect(
      await lintMarkupSource('<SectionLayout page={{ ...page, blocks }} />', {
        file: 'src/pages/example.astro',
      }),
    ).toEqual([]);
  });

  it('keeps the repository compliant', async () => {
    expect(await checkCssPolicy()).toEqual([]);
  });
});

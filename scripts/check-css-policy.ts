import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';

const CANONICAL_BREAKPOINTS = new Set([640, 768, 1024, 1280, 1536]);
const TOKEN_SOURCE = 'src/styles/tokens.css';
const MARKUP_EXTENSIONS = new Set(['.astro', '.html', '.jsx', '.tsx']);
const LENGTH_LITERAL =
  /(?<![\w.-])-?(?:\d*\.\d+|\d+)(?:px|r?em|v(?:w|h|min|max)|dvh|svh|lvh|ch|ex|cap|ic|lh|rlh|cm|mm|q|in|pt|pc)\b/i;
const FIXED_COLOR_FUNCTION =
  /(?:^|[^\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const HEX_COLOR = /#[\da-f]{3,8}\b/i;
const COLOR_PROPERTIES = new Set([
  'accent-color',
  'background',
  'background-color',
  'border',
  'border-block',
  'border-block-color',
  'border-bottom',
  'border-bottom-color',
  'border-color',
  'border-inline',
  'border-inline-color',
  'border-left',
  'border-left-color',
  'border-right',
  'border-right-color',
  'border-top',
  'border-top-color',
  'box-shadow',
  'caret-color',
  'color',
  'column-rule',
  'fill',
  'outline',
  'outline-color',
  'stroke',
  'text-decoration',
  'text-decoration-color',
  'text-shadow',
]);
const COLOR_SYNTAX_WORDS = new Set([
  'a98-rgb',
  'at',
  'background',
  'border-box',
  'bottom',
  'calc',
  'center',
  'circle',
  'closest-corner',
  'closest-side',
  'color-mix',
  'contain',
  'content-box',
  'cover',
  'currentcolor',
  'dashed',
  'decreasing',
  'display-p3',
  'dotted',
  'double',
  'ellipse',
  'farthest-corner',
  'farthest-side',
  'fixed',
  'from',
  'groove',
  'hidden',
  'hsl',
  'hue',
  'hwb',
  'in',
  'increasing',
  'inherit',
  'initial',
  'inset',
  'lab',
  'lch',
  'left',
  'linear-gradient',
  'line-through',
  'local',
  'longer',
  'no-repeat',
  'none',
  'normal',
  'oklab',
  'oklch',
  'outset',
  'overline',
  'padding-box',
  'prophoto-rgb',
  'radial-gradient',
  'rec2020',
  'repeat',
  'repeat-x',
  'repeat-y',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'revert',
  'revert-layer',
  'ridge',
  'right',
  'round',
  'scroll',
  'shorter',
  'solid',
  'space',
  'srgb',
  'srgb-linear',
  'to',
  'top',
  'unset',
  'underline',
  'var',
  'wavy',
  'xyz',
  'xyz-d50',
  'xyz-d65',
]);

export type CssPolicyRule =
  | 'ad-hoc-breakpoint'
  | 'desktop-first-breakpoint'
  | 'inline-style'
  | 'invalid-css'
  | 'literal-color'
  | 'literal-size';

export interface CssPolicyViolation {
  file: string;
  line: number;
  rule: CssPolicyRule;
  value: string;
}

interface LintOptions {
  file: string;
}

function normalized(file: string): string {
  return file.replaceAll('\\', '/');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function maskPreservingLines(value: string): string {
  return value.replace(/[^\r\n]/g, ' ');
}

function maskFunction(value: string, functionName: string): string {
  const chars = [...value];
  const expression = new RegExp(`\\b${functionName}\\s*\\(`, 'gi');

  for (const match of value.matchAll(expression)) {
    const start = match.index;
    const opening = value.indexOf('(', start);
    let depth = 0;
    let quote = '';

    for (let index = opening; index < value.length; index += 1) {
      const character = value[index];

      if (quote) {
        if (character === quote && value[index - 1] !== '\\') quote = '';
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          chars.fill(' ', start, index + 1);
          break;
        }
      }
    }
  }

  return chars.join('');
}

function hasLiteralColor(property: string, value: string): boolean {
  const withoutUrls = maskFunction(value, 'url');
  if (
    HEX_COLOR.test(withoutUrls) ||
    FIXED_COLOR_FUNCTION.test(withoutUrls)
  ) {
    return true;
  }

  const isColorValue =
    property.startsWith('--') || COLOR_PROPERTIES.has(property.toLowerCase());
  if (!isColorValue) return false;

  const withoutCustomPropertyNames = withoutUrls
    .replace(/--[\w-]+/g, '')
    .replace(/-?(?:\d*\.\d+|\d+)(?:[a-z%]+)?/gi, '');
  const words =
    withoutCustomPropertyNames.match(/[a-z][\w-]*/gi)?.map((word) =>
      word.toLowerCase(),
    ) ?? [];

  return words.some((word) => !COLOR_SYNTAX_WORDS.has(word));
}

export function lintCssSource(
  source: string,
  { file }: LintOptions,
): CssPolicyViolation[] {
  const normalizedFile = normalized(file);
  if (normalizedFile.endsWith(TOKEN_SOURCE)) return [];

  const violations: CssPolicyViolation[] = [];
  let root;

  try {
    root = postcss.parse(source, { from: file });
  } catch (error) {
    const syntaxError = error as { line?: number; reason?: string };
    return [
      {
        file: normalizedFile,
        line: syntaxError.line ?? 1,
        rule: 'invalid-css',
        value: syntaxError.reason ?? 'Unable to parse CSS',
      },
    ];
  }

  root.walkAtRules('media', (atRule) => {
    const widthCondition = /\((min|max)-width\s*:\s*([^)]+)\)/gi;
    let sawWidthCondition = false;

    for (const match of atRule.params.matchAll(widthCondition)) {
      sawWidthCondition = true;
      const [, direction, rawWidth] = match;
      const width = rawWidth.trim().match(/^(\d+)px$/i);

      if (direction.toLowerCase() === 'max') {
        violations.push({
          file: normalizedFile,
          line: atRule.source?.start?.line ?? 1,
          rule: 'desktop-first-breakpoint',
          value: compact(atRule.toString()),
        });
      } else if (!width || !CANONICAL_BREAKPOINTS.has(Number(width[1]))) {
        violations.push({
          file: normalizedFile,
          line: atRule.source?.start?.line ?? 1,
          rule: 'ad-hoc-breakpoint',
          value: compact(atRule.toString()),
        });
      }
    }

    if (!sawWidthCondition && /\bwidth\b/i.test(atRule.params)) {
      violations.push({
        file: normalizedFile,
        line: atRule.source?.start?.line ?? 1,
        rule: 'ad-hoc-breakpoint',
        value: compact(atRule.toString()),
      });
    }
  });

  root.walkDecls((declaration) => {
    const line = declaration.source?.start?.line ?? 1;

    if (LENGTH_LITERAL.test(declaration.value)) {
      violations.push({
        file: normalizedFile,
        line,
        rule: 'literal-size',
        value: compact(declaration.toString()),
      });
    }

    if (hasLiteralColor(declaration.prop, declaration.value)) {
      violations.push({
        file: normalizedFile,
        line,
        rule: 'literal-color',
        value: compact(declaration.toString()),
      });
    }
  });

  return violations;
}

function withoutAstroFrontmatter(source: string): string {
  if (!source.startsWith('---')) return source;
  const closing = source.indexOf('\n---', 3);
  if (closing === -1) return source;
  return (
    maskPreservingLines(source.slice(0, closing + 4)) +
    source.slice(closing + 4)
  );
}

export function lintMarkupSource(
  source: string,
  { file }: LintOptions,
): CssPolicyViolation[] {
  const normalizedFile = normalized(file);
  const markup = withoutAstroFrontmatter(source).replace(
    /<!--[\s\S]*?-->/g,
    maskPreservingLines,
  );
  const violations: CssPolicyViolation[] = [];
  const inlineStyle = /<(?!style\b)[a-z][^>]*\sstyle\s*=/gi;

  for (const match of markup.matchAll(inlineStyle)) {
    violations.push({
      file: normalizedFile,
      line: lineAt(markup, match.index),
      rule: 'inline-style',
      value: compact(match[0]),
    });
  }

  const styleBlock = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi;
  for (const match of markup.matchAll(styleBlock)) {
    const content = match[1];
    const contentOffset = match.index + match[0].indexOf(content);
    const firstContentLine = lineAt(markup, contentOffset);

    violations.push(
      ...lintCssSource(content, { file: normalizedFile }).map((violation) => ({
        ...violation,
        line: violation.line + firstContentLine - 1,
      })),
    );
  }

  return violations;
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(target) : [target];
    }),
  );
  return nested.flat();
}

export async function checkCssPolicy(
  rootDirectory = process.cwd(),
): Promise<CssPolicyViolation[]> {
  const sourceDirectory = path.join(rootDirectory, 'src');
  const files = await collectFiles(sourceDirectory);
  const violations: CssPolicyViolation[] = [];

  for (const absoluteFile of files) {
    const extension = path.extname(absoluteFile).toLowerCase();
    if (extension !== '.css' && !MARKUP_EXTENSIONS.has(extension)) continue;

    const file = normalized(path.relative(rootDirectory, absoluteFile));
    const source = await readFile(absoluteFile, 'utf8');
    violations.push(
      ...(extension === '.css'
        ? lintCssSource(source, { file })
        : lintMarkupSource(source, { file })),
    );
  }

  return violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.rule.localeCompare(right.rule),
  );
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const violations = await checkCssPolicy();

  if (violations.length === 0) {
    process.stdout.write('CSS policy: OK\n');
  } else {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.file}:${violation.line} ` +
          `[${violation.rule}] ${violation.value}\n`,
      );
    }
    process.stderr.write(`CSS policy: ${violations.length} violation(s)\n`);
    process.exitCode = 1;
  }
}

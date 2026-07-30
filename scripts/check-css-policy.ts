import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

const CANONICAL_BREAKPOINTS = new Set([640, 768, 1024, 1280, 1536]);
const TOKEN_SOURCE = 'src/styles/tokens.css';
const MARKUP_EXTENSIONS = new Set(['.astro', '.html', '.jsx', '.tsx']);
const WIDTH_QUERY_AT_RULES = new Set([
  'container',
  'custom-media',
  'import',
  'media',
]);
const LENGTH_LITERAL =
  /(?<![\w.-])[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?(?:cap|ch|em|ex|ic|lh|rcap|rch|rem|rex|ric|rlh|[dls]?v(?:b|h|i|max|min|w)|cq(?:b|h|i|max|min|w)|cm|mm|q|in|pc|pt|px)\b/i;
const HEX_COLOR = /^#[\da-f]{3,8}$/i;
const FIXED_COLOR_FUNCTIONS = new Set([
  'color',
  'device-cmyk',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'rgb',
  'rgba',
]);
const NAMED_COLORS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'transparent',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
  // System colours are contextual to the OS, but still cross the same reviewed
  // token boundary as `Highlight` in the forced-colours focus treatment.
  'accentcolor',
  'accentcolortext',
  'activeborder',
  'activecaption',
  'activetext',
  'appworkspace',
  'background',
  'buttonborder',
  'buttonface',
  'buttonhighlight',
  'buttonshadow',
  'buttontext',
  'canvas',
  'canvastext',
  'captiontext',
  'field',
  'fieldtext',
  'graytext',
  'highlight',
  'highlighttext',
  'inactiveborder',
  'inactivecaption',
  'inactivecaptiontext',
  'infobackground',
  'infotext',
  'linktext',
  'mark',
  'marktext',
  'menu',
  'menutext',
  'scrollbar',
  'selecteditem',
  'selecteditemtext',
  'threeddarkshadow',
  'threedface',
  'threedhighlight',
  'threedlightshadow',
  'threedshadow',
  'visitedtext',
  'window',
  'windowframe',
  'windowtext',
]);

export type CssPolicyRule =
  | 'ad-hoc-breakpoint'
  | 'desktop-first-breakpoint'
  | 'dynamic-style'
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

function inspectValue(
  value: string,
  predicate: (word: string, isFunction: boolean) => boolean,
): boolean {
  let found = false;

  valueParser(value).walk((node) => {
    if (found) return false;
    if (node.type === 'function') {
      if (node.value.toLowerCase() === 'url') return false;
      if (predicate(node.value, true)) {
        found = true;
        return false;
      }
    } else if (node.type === 'word' && predicate(node.value, false)) {
      found = true;
      return false;
    }
    return undefined;
  });

  return found;
}

function hasLiteralLength(value: string): boolean {
  return inspectValue(
    value,
    (word, isFunction) => !isFunction && LENGTH_LITERAL.test(word),
  );
}

function canContainNamedColor(property: string): boolean {
  const normalizedProperty = property.toLowerCase();
  return (
    normalizedProperty.startsWith('--') ||
    /(?:^|-)color$/.test(normalizedProperty) ||
    /^(?:accent|background|border|caret|column-rule|fill|filter|flood|initial-value|lighting|mask-border|outline|scrollbar|stroke|text-decoration|text-emphasis|text-shadow|box-shadow)(?:$|-)/.test(
      normalizedProperty,
    )
  );
}

function hasLiteralColor(property: string, value: string): boolean {
  const acceptsNamedColor = canContainNamedColor(property);
  return inspectValue(value, (word, isFunction) => {
    const normalizedWord = word.toLowerCase();
    return isFunction
      ? FIXED_COLOR_FUNCTIONS.has(normalizedWord)
      : HEX_COLOR.test(normalizedWord) ||
          (acceptsNamedColor && NAMED_COLORS.has(normalizedWord));
  });
}

function widthQueryViolation(
  params: string,
): Extract<
  CssPolicyRule,
  'ad-hoc-breakpoint' | 'desktop-first-breakpoint'
> | null {
  const query = params
    .replace(/url\((?:[^()"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')*\)/gi, ' ')
    .replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g, ' ')
    .replace(/--[\w-]+/g, ' ');
  const widthFeature =
    /(?:\b(?:min|max)-width\b|\bwidth\s*(?=[:<>=])|[<>=]\s*\bwidth\b)/i;
  if (!widthFeature.test(query)) return null;

  if (
    /(?:^|[\s,])not\s+(?=all\b|screen\b|print\b|\()/i.test(query) ||
    /\bmax-width\b/i.test(query)
  ) {
    return 'desktop-first-breakpoint';
  }

  const conditions = [...query.matchAll(/\(([^()]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((condition) => widthFeature.test(condition));

  if (conditions.length === 0) return 'ad-hoc-breakpoint';

  const everyConditionIsCanonical = conditions.every((condition) => {
    const match = condition.match(/^min-width\s*:\s*(\d+)px$/i);
    return match && CANONICAL_BREAKPOINTS.has(Number(match[1]));
  });

  return everyConditionIsCanonical ? null : 'ad-hoc-breakpoint';
}

export function lintCssSource(
  source: string,
  { file }: LintOptions,
): CssPolicyViolation[] {
  const normalizedFile = normalized(file);
  if (normalizedFile === TOKEN_SOURCE) return [];

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

  root.walkAtRules((atRule) => {
    if (!WIDTH_QUERY_AT_RULES.has(atRule.name.toLowerCase())) return;
    const rule = widthQueryViolation(atRule.params);
    if (!rule) return;

    violations.push({
      file: normalizedFile,
      line: atRule.source?.start?.line ?? 1,
      rule,
      value: compact(atRule.toString()),
    });
  });

  root.walkDecls((declaration) => {
    const line = declaration.source?.start?.line ?? 1;

    if (hasLiteralLength(declaration.value)) {
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
  const inlineStyle = /<(?!style\b)[a-z][^>]*\sstyle(?::list)?\s*=/gi;

  for (const match of markup.matchAll(inlineStyle)) {
    violations.push({
      file: normalizedFile,
      line: lineAt(markup, match.index),
      rule: 'inline-style',
      value: compact(match[0]),
    });
  }

  // An attribute spread is opaque at this boundary: even `{...props}` can
  // publish a `style` attribute at runtime, so markup in this static site uses
  // explicit attributes instead.
  const attributeSpread = /<(?!style\b)[a-z][^>]*\s\{\s*\.\.\./gi;
  for (const match of markup.matchAll(attributeSpread)) {
    violations.push({
      file: normalizedFile,
      line: lineAt(markup, match.index),
      rule: 'inline-style',
      value: compact(match[0]),
    });
  }

  const styleBlock =
    /<style\b([^>]*?)(?:\/>|>([\s\S]*?)<\/style\s*>)/gi;
  for (const match of markup.matchAll(styleBlock)) {
    const attributes = match[1];
    const content = match[2] ?? '';
    const contentOffset = match.index + match[0].indexOf(content);
    const firstContentLine = lineAt(markup, contentOffset);
    const isDynamic =
      /\b(?:dangerouslySetInnerHTML|define:vars|set:(?:html|text))\s*=/i.test(
        attributes,
      ) ||
      /\{\s*\.\.\./.test(attributes) ||
      /^\s*\{[\s\S]*\}\s*$/.test(content);

    if (isDynamic) {
      violations.push({
        file: normalizedFile,
        line: lineAt(markup, match.index),
        rule: 'dynamic-style',
        value: compact(match[0]),
      });
      continue;
    }

    violations.push(
      ...lintCssSource(content, { file: normalizedFile }).map((violation) => ({
        ...violation,
        line: violation.line + firstContentLine - 1,
      })),
    );
  }

  return violations.sort(
    (left, right) =>
      left.line - right.line || left.rule.localeCompare(right.rule),
  );
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

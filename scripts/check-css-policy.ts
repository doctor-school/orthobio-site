import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseAstro } from '@astrojs/compiler';
import type {
  Node as AstroNode,
  TagLikeNode as AstroTagLikeNode,
} from '@astrojs/compiler/types';
import * as cssTree from 'css-tree';
import {
  parseFragment,
  type DefaultTreeAdapterTypes as HtmlTree,
  type ParserError,
} from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import ts from 'typescript';

const CANONICAL_BREAKPOINTS = new Set([640, 768, 1024, 1280, 1536]);
const TOKEN_SOURCE = 'src/styles/tokens.css';
const MARKUP_EXTENSIONS = new Set(['.astro', '.html', '.jsx', '.tsx']);
const CSS_ESCAPE = /\\(?:[\da-f]{1,6}\s?|[^\n\r\f])/i;
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
const COLOR_VALUE_FUNCTIONS = new Set([
  'color-mix',
  'cross-fade',
  'drop-shadow',
  'image',
  'image-set',
  'light-dark',
]);
const WIDTH_FEATURES = new Set([
  'device-width',
  'inline-size',
  'max-inline-size',
  'max-device-width',
  'max-width',
  'min-device-width',
  'min-inline-size',
  'min-width',
  'width',
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
  | 'escaped-syntax'
  | 'inline-style'
  | 'invalid-css'
  | 'invalid-markup'
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

function valueHasEscapedSyntax(value: string): boolean {
  let found = false;
  valueParser(value).walk((node) => {
    if (found || node.type === 'string' || node.type === 'comment') {
      return false;
    }
    if (
      (node.type === 'function' || node.type === 'word') &&
      CSS_ESCAPE.test(node.value)
    ) {
      found = true;
      return false;
    }
    if (
      node.type === 'function' &&
      node.value.toLowerCase() === 'url'
    ) {
      return false;
    }
    return undefined;
  });
  return found;
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
  const normalizedProperty = property
    .toLowerCase()
    .replace(/^-(?:moz|ms|o|webkit)-/, '');
  return (
    normalizedProperty.startsWith('--') ||
    /(?:^|-)(?:color|fill|stroke)$/.test(normalizedProperty) ||
    /^(?:accent|background|border|caret|column-rule|fill|filter|flood|initial-value|lighting|mask-border|outline|scrollbar|stroke|text-decoration|text-emphasis|text-shadow|box-shadow)(?:$|-)/.test(
      normalizedProperty,
    )
  );
}

type ParsedValueNode = valueParser.Node;

function isTrivia(node: ParsedValueNode): boolean {
  return node.type === 'comment' || node.type === 'space';
}

function isTokenDerivedColorFunction(
  node: valueParser.FunctionNode,
): boolean {
  const meaningful = node.nodes.filter((child) => !isTrivia(child));
  const isRelative =
    meaningful[0]?.type === 'word' &&
    meaningful[0].value.toLowerCase() === 'from' &&
    (meaningful[1]?.type === 'function'
      ? meaningful[1].value.toLowerCase() === 'var'
      : meaningful[1]?.type === 'word' &&
        meaningful[1].value.toLowerCase() === 'currentcolor');

  if (isRelative) return true;

  return (
    meaningful.some(
      (child) =>
        child.type === 'function' && child.value.toLowerCase() === 'var',
    ) &&
    meaningful.every(
      (child) =>
        child.type === 'div' ||
        (child.type === 'function' && child.value.toLowerCase() === 'var'),
    )
  );
}

function hasLiteralColor(property: string, value: string): boolean {
  const acceptsNamedColor = canContainNamedColor(property);
  let found = false;

  function visit(nodes: ParsedValueNode[], insideColorFunction = false): void {
    for (const node of nodes) {
      if (found || node.type === 'string' || node.type === 'comment') continue;

      if (node.type === 'word') {
        const word = node.value.toLowerCase();
        if (
          HEX_COLOR.test(word) ||
          ((acceptsNamedColor || insideColorFunction) &&
            NAMED_COLORS.has(word))
        ) {
          found = true;
        }
        continue;
      }

      if (node.type !== 'function') continue;
      const functionName = node.value.toLowerCase();
      if (functionName === 'url') continue;

      if (
        FIXED_COLOR_FUNCTIONS.has(functionName) &&
        !isTokenDerivedColorFunction(node)
      ) {
        found = true;
        continue;
      }

      visit(
        node.nodes,
        insideColorFunction ||
          COLOR_VALUE_FUNCTIONS.has(functionName) ||
          functionName.endsWith('gradient'),
      );
    }
  }

  visit(valueParser(value).nodes);
  return found;
}

interface QueryNode {
  type: string;
  children?: QueryNode[];
  condition?: QueryNode | null;
  left?: QueryNode | null;
  middle?: QueryNode | null;
  modifier?: string | null;
  name?: string;
  right?: QueryNode | null;
  unit?: string;
  value?: QueryNode | string;
}

type BreakpointRule = Extract<
  CssPolicyRule,
  'ad-hoc-breakpoint' | 'desktop-first-breakpoint'
>;

function visitQueryNodes(
  node: QueryNode,
  visitor: (node: QueryNode) => void,
): void {
  visitor(node);
  for (const child of node.children ?? []) visitQueryNodes(child, visitor);
  for (const child of [
    node.condition,
    node.left,
    node.middle,
    node.right,
  ]) {
    if (child) visitQueryNodes(child, visitor);
  }
}

function queryNodeContainsSizeFeature(node: QueryNode): boolean {
  let found = false;
  visitQueryNodes(node, (descendant) => {
    if (
      descendant.type === 'Feature' &&
      WIDTH_FEATURES.has(descendant.name?.toLowerCase() ?? '')
    ) {
      found = true;
    }
    if (descendant.type === 'FeatureRange') {
      const parts = [
        descendant.left,
        descendant.middle,
        descendant.right,
      ];
      if (
        parts.some(
          (part) =>
            part?.type === 'Identifier' &&
            WIDTH_FEATURES.has(part.name?.toLowerCase() ?? ''),
        )
      ) {
        found = true;
      }
    }
  });
  return found;
}

function queryViolation(
  query: string,
  context: 'condition' | 'mediaQueryList',
): BreakpointRule | null {
  let ast: QueryNode;

  try {
    // css-tree 3 understands Media Queries Level 4. Its published community
    // types still model v2, so the plain AST is narrowed at this boundary.
    ast = cssTree.toPlainObject(
      cssTree.parse(query, { context }),
    ) as unknown as QueryNode;
  } catch {
    return /(?:--[\w-]+|(?:inline-size|width))/i.test(query)
      ? 'ad-hoc-breakpoint'
      : null;
  }

  let hasAlias = false;
  let hasNegatedSizeFeature = false;
  let hasSizeFeature = false;
  let hasDesktopFirstFeature = false;
  let hasInvalidFeature = false;

  visitQueryNodes(ast, (node) => {
    if (
      node.type === 'MediaQuery' &&
      node.modifier === 'not' &&
      node.condition &&
      queryNodeContainsSizeFeature(node.condition)
    ) {
      hasNegatedSizeFeature = true;
    }
    if (
      node.type === 'Condition' &&
      node.children?.some(
        (child) =>
          child.type === 'Identifier' &&
          child.name?.toLowerCase() === 'not',
      ) &&
      queryNodeContainsSizeFeature(node)
    ) {
      hasNegatedSizeFeature = true;
    }

    if (node.type === 'Feature') {
      const name = node.name?.toLowerCase() ?? '';
      if (name.startsWith('--')) {
        hasAlias = true;
        return;
      }
      if (!WIDTH_FEATURES.has(name)) return;

      hasSizeFeature = true;
      if (name.startsWith('max-')) {
        hasDesktopFirstFeature = true;
        return;
      }
      if (name !== 'min-width') {
        hasInvalidFeature = true;
        return;
      }

      const value =
        typeof node.value === 'object' ? node.value : undefined;
      if (
        value?.type !== 'Dimension' ||
        value.unit?.toLowerCase() !== 'px' ||
        !CANONICAL_BREAKPOINTS.has(
          Number(typeof value.value === 'string' ? value.value : NaN),
        )
      ) {
        hasInvalidFeature = true;
      }
    }

    if (node.type === 'FeatureRange') {
      const parts = [node.left, node.middle, node.right].filter(
        (part): part is QueryNode => Boolean(part),
      );
      if (
        parts.some(
          (part) =>
            part.type === 'Identifier' &&
            WIDTH_FEATURES.has(part.name?.toLowerCase() ?? ''),
        )
      ) {
        hasSizeFeature = true;
        hasInvalidFeature = true;
      }
    }
  });

  // Custom-media aliases are intentionally unsupported: their polarity and
  // width can change away from the use site, defeating local policy proof.
  if (hasAlias) return 'ad-hoc-breakpoint';
  if (
    hasSizeFeature &&
    (hasNegatedSizeFeature || hasDesktopFirstFeature)
  ) {
    return 'desktop-first-breakpoint';
  }
  return hasInvalidFeature ? 'ad-hoc-breakpoint' : null;
}

function importMediaQuery(params: string): string {
  const nodes = valueParser(params).nodes;
  let sourceFound = false;

  const mediaNodes = nodes.filter((node) => {
    if (isTrivia(node)) return sourceFound;

    if (
      !sourceFound &&
      (node.type === 'string' ||
        (node.type === 'function' &&
          node.value.toLowerCase() === 'url'))
    ) {
      sourceFound = true;
      return false;
    }

    if (!sourceFound) return false;
    if (node.type === 'word' && node.value.toLowerCase() === 'layer') {
      return false;
    }
    if (
      node.type === 'function' &&
      ['layer', 'supports'].includes(node.value.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return valueParser.stringify(mediaNodes).trim();
}

function atRuleBreakpointViolation(
  name: string,
  params: string,
): BreakpointRule | null {
  switch (name.toLowerCase()) {
    case 'custom-media':
      return 'ad-hoc-breakpoint';
    case 'media':
      return queryViolation(params, 'mediaQueryList');
    case 'container': {
      const containerQuery = params.trim();
      const hasLeadingName =
        !containerQuery.startsWith('(') &&
        !/^(?:not(?:\s|\()|scroll-state\(|style\()/i.test(
          containerQuery,
        );
      const nameEnd = containerQuery.search(/\s/);
      if (hasLeadingName && nameEnd === -1) return null;
      const query = hasLeadingName
        ? containerQuery.slice(nameEnd).trim()
        : containerQuery;
      return query ? queryViolation(query, 'condition') : null;
    }
    case 'import': {
      const mediaQuery = importMediaQuery(params);
      return mediaQuery
        ? queryViolation(mediaQuery, 'mediaQueryList')
        : null;
    }
    default:
      return null;
  }
}

function atRuleHasEscapedSyntax(name: string, params: string): boolean {
  if (CSS_ESCAPE.test(name)) return true;
  switch (name.toLowerCase()) {
    case 'container':
    case 'custom-media':
    case 'media':
      return CSS_ESCAPE.test(params);
    case 'import':
      return CSS_ESCAPE.test(importMediaQuery(params));
    default:
      return false;
  }
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
    if (atRuleHasEscapedSyntax(atRule.name, atRule.params)) {
      violations.push({
        file: normalizedFile,
        line: atRule.source?.start?.line ?? 1,
        rule: 'escaped-syntax',
        value: compact(atRule.toString()),
      });
      return;
    }

    const rule = atRuleBreakpointViolation(atRule.name, atRule.params);
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

    if (
      CSS_ESCAPE.test(declaration.prop) ||
      valueHasEscapedSyntax(declaration.value)
    ) {
      violations.push({
        file: normalizedFile,
        line,
        rule: 'escaped-syntax',
        value: compact(declaration.toString()),
      });
      return;
    }

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

  return violations.sort((left, right) => left.line - right.line);
}

function sourceSnippet(
  source: string,
  start = 0,
  end = source.length,
): string {
  return compact(source.slice(start, end));
}

function isAstroTag(node: AstroNode): node is AstroTagLikeNode {
  return (
    node.type === 'element' ||
    node.type === 'component' ||
    node.type === 'custom-element' ||
    node.type === 'fragment'
  );
}

async function lintAstroSource(
  source: string,
  { file }: LintOptions,
): Promise<CssPolicyViolation[]> {
  const normalizedFile = normalized(file);
  const violations: CssPolicyViolation[] = [];
  let result;

  try {
    result = await parseAstro(source, { position: true });
  } catch (error) {
    return [
      {
        file: normalizedFile,
        line: 1,
        rule: 'invalid-markup',
        value: error instanceof Error ? error.message : 'Unable to parse Astro',
      },
    ];
  }

  if (result.diagnostics.length > 0) {
    const diagnostic = result.diagnostics[0];
    return [
      {
        file: normalizedFile,
        line: diagnostic.location.line,
        rule: 'invalid-markup',
        value: diagnostic.text,
      },
    ];
  }

  function visit(node: AstroNode): void {
    if (isAstroTag(node)) {
      const isStyleTag =
        node.type === 'element' && node.name.toLowerCase() === 'style';
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end?.offset ?? start;
      const line = node.position?.start.line ?? 1;

      for (const attribute of node.attributes) {
        if (
          ['style', 'style:list'].includes(attribute.name.toLowerCase()) ||
          (!isStyleTag && attribute.kind === 'spread')
        ) {
          violations.push({
            file: normalizedFile,
            line: attribute.position?.start.line ?? line,
            rule: 'inline-style',
            value: sourceSnippet(source, start, end),
          });
        }
      }

      if (isStyleTag) {
        const dynamicAttribute = node.attributes.some(
          (attribute) =>
            attribute.kind === 'spread' ||
            [
              'children',
              'dangerouslysetinnerhtml',
              'define:vars',
              'set:html',
              'set:text',
            ].includes(attribute.name.toLowerCase()),
        );
        const textChildren = node.children.filter(
          (child) => child.type === 'text',
        );
        const content = textChildren.map((child) => child.value).join('');
        const dynamicContent = /^\s*\{[\s\S]*\}\s*$/.test(content);

        if (dynamicAttribute || dynamicContent) {
          violations.push({
            file: normalizedFile,
            line,
            rule: 'dynamic-style',
            value: sourceSnippet(source, start, end),
          });
        } else if (content.trim()) {
          const firstContentLine =
            textChildren[0]?.position?.start.line ?? line;
          violations.push(
            ...lintCssSource(content, { file: normalizedFile }).map(
              (violation) => ({
                ...violation,
                line: violation.line + firstContentLine - 1,
              }),
            ),
          );
        }
      }
    }

    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  }

  visit(result.ast);
  return violations.sort(
    (left, right) =>
      left.line - right.line || left.rule.localeCompare(right.rule),
  );
}

function isHtmlElement(node: HtmlTree.Node): node is HtmlTree.Element {
  return 'tagName' in node;
}

function lintHtmlSource(
  source: string,
  { file }: LintOptions,
): CssPolicyViolation[] {
  const normalizedFile = normalized(file);
  const violations: CssPolicyViolation[] = [];
  const parseErrors: ParserError[] = [];
  const fragment = parseFragment(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error),
  });

  if (parseErrors.length > 0) {
    const error = parseErrors[0];
    return [
      {
        file: normalizedFile,
        line: error.startLine,
        rule: 'invalid-markup',
        value: error.code,
      },
    ];
  }

  function visit(node: HtmlTree.Node): void {
    if (isHtmlElement(node)) {
      const location = node.sourceCodeLocation;
      const styleLocation = location?.attrs?.style;

      if (styleLocation) {
        violations.push({
          file: normalizedFile,
          line: styleLocation.startLine,
          rule: 'inline-style',
          value: sourceSnippet(
            source,
            location?.startTag?.startOffset,
            location?.startTag?.endOffset,
          ),
        });
      }

      if (
        node.tagName === 'style' &&
        location?.startTag &&
        location.endTag
      ) {
        const content = source.slice(
          location.startTag.endOffset,
          location.endTag.startOffset,
        );
        violations.push(
          ...lintCssSource(content, { file: normalizedFile }).map(
            (violation) => ({
              ...violation,
              line: violation.line + location.startTag!.endLine - 1,
            }),
          ),
        );
      }
    }

    if ('childNodes' in node) {
      for (const child of node.childNodes) visit(child);
    }
    if ('content' in node) visit(node.content);
  }

  visit(fragment);
  return violations.sort(
    (left, right) =>
      left.line - right.line || left.rule.localeCompare(right.rule),
  );
}

function lintJsxSource(
  source: string,
  { file }: LintOptions,
): CssPolicyViolation[] {
  const normalizedFile = normalized(file);
  const violations: CssPolicyViolation[] = [];
  const scriptKind = file.toLowerCase().endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  function lineOf(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      .line + 1;
  }

  function openingHasDynamicStyle(
    opening: ts.JsxOpeningLikeElement,
  ): boolean {
    return opening.attributes.properties.some(
      (attribute) =>
        ts.isJsxSpreadAttribute(attribute) ||
        (ts.isJsxAttribute(attribute) &&
          ['children', 'dangerouslysetinnerhtml'].includes(
            attribute.name.getText(sourceFile).toLowerCase(),
          )),
    );
  }

  function inspectInlineStyleAttributes(
    opening: ts.JsxOpeningLikeElement,
    includeSpreads: boolean,
  ): void {
    for (const attribute of opening.attributes.properties) {
      if (
        (includeSpreads && ts.isJsxSpreadAttribute(attribute)) ||
        (ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile).toLowerCase() === 'style')
      ) {
        violations.push({
          file: normalizedFile,
          line: lineOf(attribute),
          rule: 'inline-style',
          value: sourceSnippet(
            source,
            opening.getStart(sourceFile),
            opening.getEnd(),
          ),
        });
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(sourceFile) === 'style') {
        inspectInlineStyleAttributes(node, false);
        if (openingHasDynamicStyle(node)) {
          violations.push({
            file: normalizedFile,
            line: lineOf(node),
            rule: 'dynamic-style',
            value: sourceSnippet(
              source,
              node.getStart(sourceFile),
              node.getEnd(),
            ),
          });
        }
      } else {
        inspectInlineStyleAttributes(node, true);
      }
    }

    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      if (opening.tagName.getText(sourceFile) === 'style') {
        inspectInlineStyleAttributes(opening, false);
        const dynamicContent = node.children.some(
          (child) =>
            (ts.isJsxExpression(child) && Boolean(child.expression)) ||
            (!ts.isJsxText(child) && !ts.isJsxExpression(child)),
        );

        if (openingHasDynamicStyle(opening) || dynamicContent) {
          violations.push({
            file: normalizedFile,
            line: lineOf(node),
            rule: 'dynamic-style',
            value: sourceSnippet(
              source,
              node.getStart(sourceFile),
              node.getEnd(),
            ),
          });
        } else {
          const textChildren = node.children.filter(ts.isJsxText);
          const content = textChildren
            .map((child) => child.getText(sourceFile))
            .join('');
          if (content.trim()) {
            const firstContentLine = lineOf(textChildren[0]);
            violations.push(
              ...lintCssSource(content, { file: normalizedFile }).map(
                (violation) => ({
                  ...violation,
                  line: violation.line + firstContentLine - 1,
                }),
              ),
            );
          }
        }
      } else {
        inspectInlineStyleAttributes(opening, true);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations.sort(
    (left, right) =>
      left.line - right.line || left.rule.localeCompare(right.rule),
  );
}

export async function lintMarkupSource(
  source: string,
  options: LintOptions,
): Promise<CssPolicyViolation[]> {
  const extension = path.extname(options.file).toLowerCase();
  if (extension === '.astro') return lintAstroSource(source, options);
  if (extension === '.html') return lintHtmlSource(source, options);
  return lintJsxSource(source, options);
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
        : await lintMarkupSource(source, { file })),
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

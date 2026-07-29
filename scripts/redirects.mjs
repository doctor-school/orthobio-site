// Redirect map -> nginx snippet. Pure functions only; the CLI wrapper that
// touches the filesystem is `generate-nginx-redirects.mjs`.
//
// Everything here exists to keep an nginx config generated from a data file
// from becoming a config-injection hole: the generated snippet is `include`d
// by a vhost that also serves Mattermost's and Zitadel's neighbour on the same
// host, so a stray `}` in a YAML value must fail HERE, loudly, and never reach
// `nginx -t`.

import { parse } from 'yaml';

/**
 * @typedef {Object} Redirect
 * @property {string} from   Absolute request path on this site.
 * @property {string} to     Absolute path, or a full https:// URL.
 * @property {301|302|307|308} status
 * @property {'exact'|'prefix'} match
 * @property {{name: string, value: string} | null} query
 *   Query-argument condition, or null when the entry matches the path alone.
 */

const DEFAULT_STATUS = 301;
const ALLOWED_STATUS = new Set([301, 302, 307, 308]);
const ALLOWED_MATCH = new Set(['exact', 'prefix']);

/**
 * nginx variable suffix: `query: { i: … }` is read as `$arg_i`. Anything that
 * is not a bare identifier would produce a variable name nginx cannot parse.
 */
const SAFE_QUERY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Query VALUES are compared inside a double-quoted nginx string, so the
 * excluded set differs from SAFE_PATH: `"` would close the string, `$` would
 * interpolate a variable inside it, and `\` is nginx's escape character.
 * Statement/block syntax (`;` `{` `}` `#`) and whitespace stay excluded for the
 * same reason as in paths. What remains covers every legacy `?i=` id we
 * migrate — they are the operator's internal keys, e.g. `dr.reddys` and
 * `CSCPharmaRussia`, so DOTS and UPPERCASE are deliberately allowed here even
 * though our own slugs never use them.
 */
const SAFE_QUERY_VALUE = /^[A-Za-z0-9\-._~%!&()*+,=:@/]+$/;

// Deliberately narrow. Every character nginx treats as syntax inside a
// `server {}` block is excluded, because that is where the generated file ends
// up: `;` (statement terminator — `to: /new;internal` would smuggle a second
// directive past both this check and the host-side allowlist, PR #15 review),
// `#` (comment — it would swallow the closing `;` and `}` of our own block),
// `{` `}`, `$` (variable sigil), quotes of both kinds, whitespace, and
// control characters. What remains is unreserved URL characters plus the
// sub-delims that occur in paths we would actually author.
//
// A `#` fragment in a redirect target is the one legitimate URL construct this
// rejects: nginx cannot carry it in a `return` value unquoted, and the failure
// mode would be a broken config rather than a wrong redirect.
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/%!&()*+,=:@]*$/;
const SAFE_ABSOLUTE_URL = /^https:\/\/[A-Za-z0-9\-._~%!&()*+,=:@/?]+$/;

/**
 * Parse and validate the redirect map. Throws on the first offending entry —
 * a half-applied redirect map is worse than none.
 *
 * @param {string} yamlText Raw contents of `infra/redirects.yaml`.
 * @returns {Redirect[]}
 */
export function parseRedirects(yamlText) {
  const doc = parse(yamlText);
  if (doc === null || doc === undefined) return [];
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('redirects.yaml: top level must be a mapping with a `redirects` key');
  }
  const raw = doc.redirects;
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error('redirects.yaml: `redirects` must be a list');
  }

  const seen = new Set();
  return raw.map((entry, i) => {
    const at = `redirects[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${at}: must be a mapping`);
    }

    const { from, to } = entry;
    const status = entry.status ?? DEFAULT_STATUS;
    const match = entry.match ?? 'exact';
    const query = parseQuery(entry.query, at);

    if (query !== null && match !== 'exact') {
      throw new Error(
        `${at}: \`query\` requires match "exact" — a query condition applies to one URL, not a subtree`,
      );
    }
    if (typeof from !== 'string' || !SAFE_PATH.test(from)) {
      throw new Error(`${at}.from: must be an absolute path of safe URL characters, got ${JSON.stringify(from)}`);
    }
    if (typeof to !== 'string' || !(SAFE_PATH.test(to) || SAFE_ABSOLUTE_URL.test(to))) {
      throw new Error(`${at}.to: must be an absolute path or an https:// URL, got ${JSON.stringify(to)}`);
    }
    if (!ALLOWED_STATUS.has(status)) {
      throw new Error(`${at}.status: must be one of 301 302 307 308, got ${JSON.stringify(status)}`);
    }
    if (!ALLOWED_MATCH.has(match)) {
      throw new Error(`${at}.match: must be "exact" or "prefix", got ${JSON.stringify(match)}`);
    }
    // A redirect to itself is a loop nginx will happily serve forever. Compared
    // slash-insensitively: since both forms of the source are emitted,
    // `/a` -> `/a/` would produce `location = /a/ { return 301 /a/; }`.
    if (canonicalSource(from) === canonicalSource(to)) {
      throw new Error(`${at}: redirects to itself (${from} -> ${to})`);
    }
    // Duplicates are compared slash-insensitively because rendering covers both
    // forms of every source: `/a` and `/a/` produce overlapping `location`
    // blocks, and nginx refuses a config with a duplicated exact location.
    //
    // The query condition is part of the identity: `/company?i=a` and
    // `/company?i=b` share a path on purpose and are rendered as two `if`s
    // inside ONE location block. Two entries with the same path AND the same
    // condition are still a duplicate — the second `if` could never be reached.
    const key = querySignature(canonicalSource(from), query);
    if (seen.has(key)) {
      throw new Error(
        query === null
          ? `${at}.from: duplicate source path ${from} — /x and /x/ are the same entry here, and the second would never match`
          : `${at}: duplicate source ${key} — the second condition could never be reached`,
      );
    }
    seen.add(key);

    return { from, to, status, match, query };
  });
}

/**
 * Validate the optional `query` condition of one entry.
 *
 * Exactly ONE argument, deliberately: nginx has no `and` in a `location`-level
 * `if`, so a two-argument condition could not be rendered without nesting
 * `if`s — which nginx does not allow either. Every URL this migrates
 * (`/company?i=<id>`) keys on a single argument.
 *
 * @param {unknown} raw
 * @param {string} at Diagnostic prefix, e.g. `redirects[3]`.
 * @returns {{name: string, value: string} | null}
 */
function parseQuery(raw, at) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${at}.query: must be a mapping of one argument name to its value`);
  }
  const names = Object.keys(raw);
  if (names.length !== 1) {
    throw new Error(
      `${at}.query: must name exactly one argument, got ${names.length} (${names.join(', ')})`,
    );
  }
  const [name] = names;
  const value = raw[name];
  if (!SAFE_QUERY_NAME.test(name)) {
    throw new Error(
      `${at}.query: argument name must be a bare identifier (rendered as $arg_${name}), got ${JSON.stringify(name)}`,
    );
  }
  if (typeof value !== 'string' || !SAFE_QUERY_VALUE.test(value)) {
    throw new Error(
      `${at}.query.${name}: must be a non-empty string of safe URL characters, got ${JSON.stringify(value)}`,
    );
  }
  return { name, value };
}

/** Identity of a source: its canonical path plus any query condition. */
function querySignature(path, query) {
  return query === null ? path : `${path}?${query.name}=${query.value}`;
}

/**
 * Render validated entries as an nginx snippet for inclusion in a `server {}`
 * block.
 *
 * BOTH slash forms of every source are emitted. The site serves `/program` and
 * `/program/` alike (Astro's directory build plus `try_files $uri $uri/`), so
 * both are live, linkable and indexable — and a November map written from the
 * page list would otherwise 404 half the published URL space (PR #15 review).
 *
 * `exact` becomes `location = /x` and `location = /x/`. An exact location is
 * resolved before any prefix or regex location, so a redirect always wins over
 * `try_files`, even while the file of that name is still in the build.
 *
 * `prefix` becomes `location ^~ /x/`, which appends the untouched remainder of
 * the request to the target so a whole subtree moves in one entry, plus an
 * exact block for the bare `/x` that sends it to the target root.
 *
 * Entries carrying a `query` condition are GROUPED by path and rendered as one
 * location per slash form — see `renderQueryLocation`.
 *
 * @param {Redirect[]} entries
 * @returns {string} nginx configuration text, newline-terminated.
 */
export function renderNginxRedirects(entries) {
  const header = [
    '# GENERATED by scripts/generate-nginx-redirects.mjs from infra/redirects.yaml.',
    '# Do not edit on the host: the next deploy overwrites it. Edit the YAML.',
    '',
  ];

  if (entries.length === 0) {
    return [...header, '# No redirects are active.', ''].join('\n');
  }

  /*
   * A path with any query-conditional entry becomes ONE location block holding
   * every condition for that path, because nginx allows a single `location =`
   * per URI. The bare (unconditional) entry for the same path, when the map has
   * one, becomes that block's fallthrough `return`.
   *
   * Grouped paths are rendered at their FIRST appearance so the snippet keeps
   * the reading order of the YAML.
   */
  const queryPaths = new Set(
    entries.filter((e) => e.query !== null).map((e) => canonicalSource(e.from)),
  );
  const rendered = new Set();

  const blocks = entries.flatMap((entry) => {
    const { from, to, status, match, query } = entry;
    const path = canonicalSource(from);

    if (queryPaths.has(path)) {
      if (rendered.has(path)) return [];
      rendered.add(path);
      return renderQueryLocation(
        path,
        entries.filter((e) => canonicalSource(e.from) === path),
      );
    }
    void query;
    return renderPlain(from, to, status, match);
  });

  return [...header, ...blocks, ''].join('\n');
}

/**
 * One `location` per slash form of `path`, with an `if` per query condition and
 * the unconditional entry (if any) as the fallthrough.
 *
 * `if` inside `location` is normally to be avoided, but `if` + `return` is one
 * of the two constructs nginx documents as safe there ("If Is Evil" — the
 * hazards are `if` combined with other content-phase directives, not with
 * `return`). It is also the only mechanism available: matching on a query
 * argument otherwise needs a `map`, and `map` is an `http`-context directive
 * while this snippet is `include`d inside `server {}`.
 *
 * A request whose argument matches nothing and that has no unconditional entry
 * simply falls through to the vhost's `try_files`, i.e. 404 — deliberately, so
 * an unknown id is not silently redirected somewhere plausible.
 *
 * @param {string} path Canonical (slash-stripped) source path.
 * @param {Redirect[]} group Every entry sharing that path.
 * @returns {string[]}
 */
function renderQueryLocation(path, group) {
  const conditions = group
    .filter((e) => e.query !== null)
    .map((e) => `    if ($arg_${e.query.name} = "${e.query.value}") { return ${e.status} ${e.to}; }`);
  const fallthrough = group.find((e) => e.query === null);
  const body = [
    ...conditions,
    ...(fallthrough ? [`    return ${fallthrough.status} ${fallthrough.to};`] : []),
  ];
  const slashed = path === '/' ? '/' : `${path}/`;
  const forms = path === '/' ? ['/'] : [path, slashed];
  return forms.flatMap((uri) => [`location = ${uri} {`, ...body, '}']);
}

/**
 * The path-only rendering — unchanged behaviour for every entry without a
 * `query` condition.
 *
 * @param {string} from
 * @param {string} to
 * @param {301|302|307|308} status
 * @param {'exact'|'prefix'} match
 * @returns {string[]}
 */
function renderPlain(from, to, status, match) {
  const bare = canonicalSource(from);
  const slashed = bare === '/' ? '/' : `${bare}/`;

  if (match === 'prefix' && bare === '/') {
    // Whole-site move — the November end state. `location ^~ /` would be a
    // second prefix location for `/`, which collides with the vhost's own
    // `location /` and makes `nginx -t` fail (PR #15 review). A REGEX
    // location has no such conflict and still outranks that catch-all, and
    // `return` carries the capture, so any of the four status codes works
    // here (unlike `rewrite`, which only knows permanent/redirect).
    //
    // The lookahead spares anything under a dot-directory: `/.well-known/`
    // must keep reaching certbot for renewals, and the vhost's dotfile
    // `deny` must keep winning for the rest.
    const target = to.endsWith('/') ? to : `${to}/`;
    return [
      `location = / { return ${status} ${target}; }`,
      `location ~ ^/(?!\\.)(.*)$ { return ${status} ${target}$1; }`,
    ];
  }

  if (match === 'prefix') {
    const target = to.endsWith('/') ? to : `${to}/`;
    return [
      // The `rewrite` pattern is a regex, and SAFE_PATH deliberately admits
      // `.`, `+`, `(`, `*` — legal in a URL, metacharacters in a regex.
      // Escape them or `/a+b/` would silently match something else entirely.
      `location ^~ ${slashed} { rewrite ^${escapeRegex(slashed)}(.*)$ ${target}$1 ${redirectFlag(status)}; }`,
      // The subtree root without its trailing slash: `^~ /x/` does not match
      // a bare `/x`, and that URL is just as published as the rest.
      ...(bare === '/' ? [] : [`location = ${bare} { return ${status} ${target}; }`]),
    ];
  }

  return bare === '/'
    ? [`location = / { return ${status} ${to}; }`]
    : [
        `location = ${bare} { return ${status} ${to}; }`,
        `location = ${slashed} { return ${status} ${to}; }`,
      ];
}

/**
 * The slash-insensitive identity of a source path: `/x/` and `/x` are the same
 * URL to this map, and `/` is its own canonical form.
 *
 * @param {string} from
 * @returns {string}
 */
function canonicalSource(from) {
  return from !== '/' && from.endsWith('/') ? from.slice(0, -1) : from;
}

/**
 * @param {string} literal
 * @returns {string} the literal, safe to embed in an nginx `rewrite` pattern.
 */
function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `rewrite` takes a flag, not a status code, and only knows `permanent` (301)
 * and `redirect` (302). 307/308 keep the request method, which `rewrite` cannot
 * express — those get a `return` with an explicit code instead.
 *
 * @param {301|302|307|308} status
 */
function redirectFlag(status) {
  return status === 301 ? 'permanent' : 'redirect';
}

/**
 * Prefix redirects that must preserve the request method (307/308) cannot use
 * `rewrite`'s two flags. Reject them at generation time rather than silently
 * downgrading the status code.
 *
 * @param {Redirect[]} entries
 */
export function assertRenderable(entries) {
  for (const [i, e] of entries.entries()) {
  // The root prefix renders through `return`, not `rewrite`, so it carries
  // any status code — the restriction below is about `rewrite`'s two flags.
  if (e.from === '/') continue;
  if (e.match === 'prefix' && (e.status === 307 || e.status === 308)) {
    throw new Error(
      `redirects[${i}]: match "prefix" supports status 301 or 302 only (nginx rewrite flags); ` +
        `use match "exact" for ${e.status}`,
    );
  }
  }
  return entries;
}

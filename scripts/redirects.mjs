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
 */

const DEFAULT_STATUS = 301;
const ALLOWED_STATUS = new Set([301, 302, 307, 308]);
const ALLOWED_MATCH = new Set(['exact', 'prefix']);

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
    const key = canonicalSource(from);
    if (seen.has(key)) {
      throw new Error(
        `${at}.from: duplicate source path ${from} — /x and /x/ are the same entry here, and the second would never match`,
      );
    }
    seen.add(key);

    return { from, to, status, match };
  });
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

  const blocks = entries.flatMap(({ from, to, status, match }) => {
    const bare = canonicalSource(from);
    const slashed = bare === '/' ? '/' : `${bare}/`;

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
  });

  return [...header, ...blocks, ''].join('\n');
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
    if (e.match === 'prefix' && (e.status === 307 || e.status === 308)) {
      throw new Error(
        `redirects[${i}]: match "prefix" supports status 301 or 302 only (nginx rewrite flags); ` +
          `use match "exact" for ${e.status}`,
      );
    }
  }
  return entries;
}

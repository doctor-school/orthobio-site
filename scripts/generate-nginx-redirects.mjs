// CLI: infra/redirects.yaml -> infra/nginx/redirects.generated.conf
//
// Run by `pnpm redirects:build`, and by the deploy workflow before it ships the
// snippet to the host. The generated file is committed so a reviewer sees the
// nginx that a YAML change actually produces; CI re-runs the generator and
// fails on a diff, so the committed artefact can never drift from its source.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRedirects, renderNginxRedirects, assertRenderable } from './redirects.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repoRoot, 'infra/redirects.yaml');
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(repoRoot, 'infra/nginx/redirects.generated.conf');

const entries = assertRenderable(parseRedirects(readFileSync(source, 'utf8')));

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderNginxRedirects(entries), 'utf8');

console.log(`redirects: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} -> ${target}`);

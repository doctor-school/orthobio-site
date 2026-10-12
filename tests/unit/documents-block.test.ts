import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { pageSchemaChecked } from '@/content/schemas';

/**
 * The `documents` page block (Issue #122). The e2e suite would render a card
 * pointing at a Google Drive copy just as happily as one pointing at our S3,
 * so the «only our own storage» guarantee is pinned here by value.
 */

const page = (items: unknown[]) =>
  pageSchemaChecked.safeParse({
    title: 'Консенсусы',
    blocks: [{ kind: 'documents', items }],
  });

describe('pageSchema → documents block', () => {
  it('accepts a /media/ bucket path and defaults the caption to PDF', () => {
    const r = page([{ title: 'Сборник', url: '/media/consensus/book.pdf' }]);
    expect(r.success).toBe(true);
    const block = r.data?.blocks[0];
    expect(block?.kind === 'documents' && block.items[0].url).toBe('/media/consensus/book.pdf');
    expect(block?.kind === 'documents' && block.items[0].meta).toBe('PDF');
  });

  it('keeps an explicit caption', () => {
    const r = page([{ title: 'Сборник', url: '/media/consensus/book.pdf', meta: 'PDF · 200 страниц' }]);
    expect(r.success).toBe(true);
    const block = r.data?.blocks[0];
    // prose() glues short words with nbsp, so compare modulo whitespace.
    expect(block?.kind === 'documents' && block.items[0].meta.replace(/\s/g, ' ')).toBe(
      'PDF · 200 страниц',
    );
  });

  it('rejects an external cloud link', () => {
    const r = page([{ title: 'Сборник', url: 'https://drive.google.com/file/d/abc/view' }]);
    expect(r.success).toBe(false);
  });

  it('rejects an empty document list', () => {
    expect(page([]).success).toBe(false);
  });
});

describe('documents blocks → the bucket', () => {
  // The schema tests above run on synthetic input, so a link to an object that
  // was never uploaded passed them (and CI) while the real page 404ed.
  const ROOT = new URL('../../', import.meta.url);
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8');

  const urls = readdirSync(fileURLToPath(new URL('src/content/pages/', ROOT)))
    .filter((file) => file.endsWith('.yaml'))
    .flatMap((file) => {
      const page = parse(read(`src/content/pages/${file}`)) as { blocks?: { kind: string; items?: { url: string }[] }[] };
      return (page.blocks ?? [])
        .filter((block) => block.kind === 'documents')
        .flatMap((block) => (block.items ?? []).map((item) => ({ file, url: item.url })));
    });

  it('finds the documents of the consensus page', () => {
    expect(urls.some((u) => u.file === 'consensus.yaml')).toBe(true);
  });

  it('lists every linked /media/ object in the checksum list', () => {
    const listed = new Set(
      read('docs/assets-checksums.txt')
        .split(/\r?\n/)
        .map((line) => line.split('  ')[1]),
    );
    for (const { file, url } of urls) {
      expect(url, `${file}: a documents link must point into our bucket`).toMatch(/^\/media\//);
      expect(listed.has(url.replace('/media/', '')), `${file}: ${url} is not in docs/assets-checksums.txt`).toBe(true);
    }
  });
});

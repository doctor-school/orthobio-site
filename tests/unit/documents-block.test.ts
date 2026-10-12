import { describe, expect, it } from 'vitest';

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

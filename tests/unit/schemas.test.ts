import { describe, expect, it } from 'vitest';

import { congressSchema } from '@/content/schemas';

/**
 * Unit tests for the `committee[].photo` field (Issue #23).
 *
 * Why here and not in e2e: the e2e suite asserts geometry and a11y, so a
 * committee portrait pointing at the ORIGINAL external CDN would render a
 * perfectly valid circle with a perfectly valid face and sail through — while
 * silently reintroducing exactly the link-rot dependency the whole rescue
 * exists to remove (ТЗ §4 «никаких внешних архивных ссылок»). The allowlist is
 * the load-bearing logic, so it is pinned by value here.
 */

/** Minimal valid congress record with a single committee member. */
const withMember = (member: Record<string, unknown>) =>
  congressSchema.safeParse({ year: 2026, committee: [member] });

const NAME = 'Страхов Максим Алексеевич';

describe('congressSchema → committee[].photo', () => {
  it('defaults to null when the member has no portrait', () => {
    const r = withMember({ name: NAME, regalia: null });
    expect(r.success).toBe(true);
    expect(r.data?.committee[0].photo).toBeNull();
  });

  it('keeps an explicit null — «имя + регалии без фото» stays a valid state', () => {
    const r = withMember({ name: NAME, regalia: null, photo: null });
    expect(r.success).toBe(true);
    expect(r.data?.committee[0].photo).toBeNull();
  });

  it('accepts a /media/ bucket path and stores it verbatim (no typographer)', () => {
    const url = '/media/2026/people/strahov-288.webp';
    const r = withMember({ name: NAME, regalia: null, photo: url });
    expect(r.success).toBe(true);
    expect(r.data?.committee[0].photo).toBe(url);
  });

  it('accepts an absolute URL on our own Timeweb bucket', () => {
    const url = 'https://s3.twcstorage.ru/orthobio-media/2026/people/strahov-288.webp';
    const r = withMember({ name: NAME, regalia: null, photo: url });
    expect(r.success).toBe(true);
    expect(r.data?.committee[0].photo).toBe(url);
  });

  it('rejects the external CDN the portraits were rescued FROM', () => {
    const r = withMember({
      name: NAME,
      regalia: null,
      photo: 'https://cdn.congress-ph.online/261/orgs_hum/strahov.jpg',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a protocol-relative URL — the browser resolves it as external', () => {
    const r = withMember({
      name: NAME,
      regalia: null,
      photo: '//s3.twcstorage.ru/orthobio-media/2026/people/strahov-288.webp',
    });
    expect(r.success).toBe(false);
  });

  it('leaves the name verbatim while typographizing regalia', () => {
    const r = withMember({
      name: 'Еремин И.И.',
      regalia: 'К.м.н., заместитель директора - по научной работе',
      photo: null,
    });
    expect(r.success).toBe(true);
    // Identity token: initials must not be reflowed by the typographer.
    expect(r.data?.committee[0].name).toBe('Еремин И.И.');
    // Prose field: the hyphen between spaces becomes an em dash.
    expect(r.data?.committee[0].regalia).toContain('—');
  });
});

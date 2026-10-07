import { describe, expect, it } from 'vitest';

import { CABINET_LOGIN_URL } from '../../src/config/site';
import { cabinetLoginHref, handoffFrom } from '../../src/lib/cabinet-login';

describe('handoffFrom', () => {
  it('reads the reference of an accepted sign-up', () => {
    expect(handoffFrom({ status: 'accepted', handoff: 'r3f-AB_c' })).toBe('r3f-AB_c');
  });

  it.each([
    ['an older API without the field', { status: 'accepted' }],
    ['an empty reference', { status: 'accepted', handoff: '' }],
    ['a blank reference', { status: 'accepted', handoff: '   ' }],
    ['a non-string reference', { status: 'accepted', handoff: 42 }],
    ['a body that is not JSON', null],
    ['an array body', ['handoff']],
  ])('gives nothing for %s', (_label, body) => {
    expect(handoffFrom(body)).toBeNull();
  });
});

describe('cabinetLoginHref', () => {
  it('is the configured sign-in link as is without a reference', () => {
    expect(cabinetLoginHref(CABINET_LOGIN_URL, null)).toBe(
      'https://new.doctor.school/login?method=code&returnTo=/account/congress',
    );
  });

  it('carries the reference between the method and the return path (#116)', () => {
    expect(cabinetLoginHref(CABINET_LOGIN_URL, 'r3f-AB_c')).toBe(
      'https://new.doctor.school/login?method=code&handoff=r3f-AB_c&returnTo=/account/congress',
    );
  });

  it('encodes a reference that would otherwise break the query', () => {
    const href = cabinetLoginHref(CABINET_LOGIN_URL, 'a&returnTo=https://evil.example/#x');
    const params = new URL(href).searchParams;
    expect(params.get('handoff')).toBe('a&returnTo=https://evil.example/#x');
    expect(params.getAll('returnTo')).toEqual(['/account/congress']);
    expect(params.get('method')).toBe('code');
  });

  it('puts the reference first when the link names no method', () => {
    expect(cabinetLoginHref('https://example.test/login?returnTo=/x', 'r')).toBe(
      'https://example.test/login?handoff=r&returnTo=/x',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { PRODUCTION_HOSTS, pickSitekey } from '../../src/lib/captcha';

const keys = { prod: 'ysc1_prod', preview: 'ysc1_stage' };

/** Issue #81: one build serves preview and production, so the key is chosen by host. */
describe('pickSitekey', () => {
  it.each(['orthobio.ru', 'www.orthobio.ru'])('gives the production key on %s', (host) => {
    expect(pickSitekey(host, keys)).toBe('ysc1_prod');
  });

  it.each(['new.orthobio.ru', 'localhost', '127.0.0.1', 'example.com', ''])(
    'gives the preview key on %s',
    (host) => {
      expect(pickSitekey(host, keys)).toBe('ysc1_stage');
    },
  );

  it('matches the production host regardless of case and a trailing root dot', () => {
    expect(pickSitekey('OrthoBio.RU', keys)).toBe('ysc1_prod');
    expect(pickSitekey('orthobio.ru.', keys)).toBe('ysc1_prod');
  });

  it('never borrows the other environment key when the chosen one is empty', () => {
    expect(pickSitekey('orthobio.ru', { prod: '', preview: 'ysc1_stage' })).toBe('');
    expect(pickSitekey('new.orthobio.ru', { prod: 'ysc1_prod', preview: '' })).toBe('');
  });

  it('trims whitespace around a key and treats a blank one as empty', () => {
    expect(pickSitekey('orthobio.ru', { prod: '  ysc1_prod\n', preview: '' })).toBe('ysc1_prod');
    expect(pickSitekey('new.orthobio.ru', { prod: '', preview: '   ' })).toBe('');
  });

  it('does not treat a lookalike subdomain as production', () => {
    expect(PRODUCTION_HOSTS).toEqual(['orthobio.ru', 'www.orthobio.ru']);
    expect(pickSitekey('orthobio.ru.evil.example', keys)).toBe('ysc1_stage');
    expect(pickSitekey('new.orthobio.ru', keys)).toBe('ysc1_stage');
  });
});

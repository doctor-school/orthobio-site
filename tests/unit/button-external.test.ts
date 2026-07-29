import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

import Button from '../../src/components/Button.astro';

/**
 * `Button`'s `external` branch — the new-tab announcement of Issue #37.
 *
 * DELIBERATE EXCEPTION to «unit tests are pure logic, rendering is the e2e
 * suite's job» (vitest.config.ts), for the same reason as
 * `video-card.test.ts`: the branch is not reachable from any built page. The
 * only caller is the «узнать первым» CTA on `/`, and `SUBSCRIBE_URL` is `null`
 * until the owner supplies a Telegram/email target — so the e2e sweep walks
 * zero external Buttons and would stay green if this branch never announced
 * anything at all. It is the one component whose fix nothing else can see.
 *
 * The mirror assertions matter as much: a Button that stays on the site, and a
 * `<button>` with no href, must not carry a promise of a tab.
 */
const render = (props: Record<string, unknown>, slots: Record<string, unknown> = {}) =>
  AstroContainer.create().then((container) => container.renderToString(Button, { props, slots }));

const HINT = 'открывается в новой вкладке';

describe('Button under `external`', () => {
  it('announces the new tab beside the target it opens', async () => {
    const html = await render({ href: 'https://t.me/orthobio', external: true }, {
      default: 'Узнать первым',
    });
    expect(html).toContain('target="_blank"');
    expect(html).toContain('ob-sr-only');
    expect(html).toContain(HINT);
  });

  it('says nothing about tabs when the link stays on the site', async () => {
    const html = await render({ href: '/archive/2026' }, { default: 'Программа 2026' });
    expect(html).not.toContain('target=');
    expect(html).not.toContain(HINT);
  });

  it('says nothing about tabs when it is a <button>', async () => {
    // `external` without an `href` renders the <button> branch: no navigation
    // happens at all, and the flag must not leak an announcement into it.
    const html = await render({ external: true }, { default: 'Отправить' });
    expect(html).toContain('<button');
    expect(html).not.toContain(HINT);
  });
});

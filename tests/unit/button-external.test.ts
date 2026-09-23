import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

import Button from '../../src/components/Button.astro';
import {
  NOTIFY_CHANNEL_URL,
  NOTIFY_CTA_LABEL,
  REGISTRATION_CTA_LABEL,
  REGISTRATION_URL,
} from '../../src/config/site';

/**
 * `Button`'s `external` branch — the new-tab announcement of Issue #37.
 *
 * DELIBERATE EXCEPTION to «unit tests are pure logic, rendering is the e2e
 * suite's job» (vitest.config.ts), for the same reason as
 * `video-card.test.ts`. Its first caller, the «узнать первым» CTA on `/`, was
 * replaced by the INTERNAL link to `/registration` (Issue #78), and for a
 * while no built page reached the branch at all. Since Issue #88 the one
 * external Button is the «Узнать первым» Telegram CTA on the /registration
 * «откроется» card — a card the e2e suite sees only through a mocked refusal —
 * so the branch is still pinned here, at the component, with that CTA's own
 * props.
 *
 * The mirror assertions matter as much: a Button that stays on the site, and a
 * `<button>` with no href, must not carry a promise of a tab.
 */
const render = (props: Record<string, unknown>, slots: Record<string, unknown> = {}) =>
  AstroContainer.create().then((container) => container.renderToString(Button, { props, slots }));

const HINT = 'открывается в новой вкладке';

describe('Button under `external`', () => {
  it('announces the new tab beside the target it opens', async () => {
    const html = await render({ href: NOTIFY_CHANNEL_URL, external: true, variant: 'accent' }, {
      default: NOTIFY_CTA_LABEL,
    });
    expect(html).toContain(`href="${NOTIFY_CHANNEL_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('ob-sr-only');
    expect(html).toContain(HINT);
  });

  it('keeps the home-page registration CTA in the current tab', async () => {
    const html = await render({ href: REGISTRATION_URL, size: 'lg' }, {
      default: REGISTRATION_CTA_LABEL,
    });
    expect(html).toContain('href="/registration"');
    expect(html).not.toContain('target=');
    expect(html).not.toContain(HINT);
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

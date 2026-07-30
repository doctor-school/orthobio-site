import type { APIRoute } from 'astro';

import { renderRobots } from '@/lib/seo';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  if (site === undefined) throw new Error('astro.config.mjs must define the canonical site');

  return new Response(renderRobots(site), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

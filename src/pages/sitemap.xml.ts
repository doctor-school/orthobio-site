import type { APIRoute } from 'astro';

import { getCongressYears } from '@/content';
import { partnerProfiles } from '@/lib/partners';
import { buildPublicRoutes, renderSitemap } from '@/lib/seo';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  if (site === undefined) throw new Error('astro.config.mjs must define the canonical site');

  const years = await getCongressYears();
  const profiles = partnerProfiles(years.map(({ data }) => data));
  const routes = buildPublicRoutes({
    years: years.map(({ data }) => data.year),
    profileSlugs: profiles.map(({ slug }) => slug),
  });

  return new Response(renderSitemap(site, routes), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

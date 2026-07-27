/**
 * Astro Content Layer configuration.
 *
 * One collection — `congress` — models congress year editions as YAML data
 * files under `src/content/congress/<year>.yaml`. The entry id IS the year
 * (the glob filename, e.g. `2024`).
 *
 * ── Loader-swap invariant (AGENTS.md) ────────────────────────────────────────
 * v1 reads local YAML via the built-in `glob()` loader. When the Doctor.School
 * «конструктор мероприятий» module goes live (≈ November 2026), the ONLY swap
 * point is this `loader:` — the schema in `./content/schemas` matches what the
 * CMS will emit, so `getCollection()` call sites and every component stay
 * untouched.
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { congressSchema } from './content/schemas';

const congress = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/congress' }),
  schema: congressSchema,
});

export const collections = { congress };

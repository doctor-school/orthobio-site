# orthobio-site — Agent Context

> **Language rule:** All chat dialogue with the owner MUST be in Russian. Code, code comments, commit messages, PR titles/descriptions, and this file are in English. Product content (pages, copy) is Russian.

## Project overview

Temporary static website of the **VIII Congress ОРТОБИОЛОГИЯ-2027** (`orthobio.ru`) plus a consolidated archive of the 2021–2026 congresses. Built with **Astro (SSG)**. Lifespan: launch ASAP → replaced by the Doctor.School platform module around November 2026 (registration opening), with full 301-redirect control at migration.

**Owner:** Anton (non-developer, works through AI agents). Final call on money / accounts / domain switchover only; everything else runs autonomously.
**Audience:** Russian Federation physicians — **RF accessibility is a hard constraint** (no Cloudflare-dependent chains, no Vercel; hosting on Timeweb, DNS on Beget).
**152-FZ:** this site collects NO PII — no forms, no registration. The «узнать первым» CTA is an outbound link (Telegram/email), not a form. If a form is ever requested, it must POST to an RF-hosted receiver (see `bbm-public-website` LeadForm pattern) — never collect PII in this repo.

This repo follows the conventions of its ecosystem siblings `bbm-public-website` (Astro site of bbm.academy — primary donor), `bbm-portal` (Payload CMS), and `bbm-kb`. When in doubt, look there first.

## Where to look first

1. `docs/content-map-and-tz.md` — approved ТЗ: page map, content model, principles (honest placeholders, no external archive links)
2. `docs/recon/*.md` — source-of-truth reports for all archive content (2021–2026); every fact in content YAML must trace to these
3. GitHub Issues #1–#6 — execution chain; design & decomposition live in Issues, not in docs/specs files

## Architectural decisions (do not re-litigate)

- **Astro SSG + content-as-data.** Each congress year is a YAML data file (`src/content/congress/<year>.yaml`), validated by Zod schemas at the Content Layer boundary. Layout renders from data; adding a year is content, not new markup.
- **Loader-swap invariant** (from `bbm-public-website`): content starts as local YAML; the schema mirrors the future platform module («конструктор мероприятий», Payload CMS). A future switch to a CMS loader must not require rewriting components. Keep prose fields plain text (never rich-text ASTs).
- **RU typography at the schema boundary** — apply «ёлочки»/nbsp/dashes via a `prose()` transform on enumerated fields (port `src/content/typographize.ts` from `bbm-public-website`), not inside components. Canonical content stays plain text.
- **Media on Timeweb S3** (photos, PDFs) — never hotlink external clouds; the site must survive the death of any source link.
- **Hosting on our infra** (Timeweb; reuse-survey before provisioning anything new). Redirect map lives as data (config file) so the November platform migration is a config change, not a rewrite.

## Task management

- **Plane (strategic):** DSG2-11 in workspace `doctor-school` tracks the whole effort. Status changes + milestone comments there; day-to-day work does NOT go to Plane.
- **GitHub Issues (execution):** every code task is an Issue in this repo. Design and decomposition live in the Issue body and native sub-issues — do not create spec/plan files in `docs/`.
- Link PRs with `Closes #N`.

## Per-task workflow (MANDATORY)

1. Branch `<type>/<issue#>-<slug>` (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`).
2. Implement; Conventional Commits; TDD where there is logic to test.
3. Open PR against `main`; fill `.github/PULL_REQUEST_TEMPLATE.md`.
4. **Independent review is mandatory:** the orchestrator (not the implementer) dispatches `orthobio-pr-reviewer`. Every comment gets fixed or answered with rationale; loop until no `[BLOCKER]`/`[IMPORTANT]` remains.
5. For UI-affecting PRs, run `responsive-a11y-audit` before the reviewer.
6. Merge: `gh pr merge --squash --delete-branch` — autonomous after a clean review. Owner gate applies only to money / accounts / DNS switchover (Issue #6). Contested content facts → `TODO(Антон)` marker in the artifact, do not block merge.
7. Never push to `main` directly; never force-push shared branches; no destructive git ops without explicit confirmation in chat.

## Code style

- **TypeScript strict** — no unjustified `any`.
- **pnpm** (ecosystem standard), Node 22.
- Prefer `.astro` components; **no client-side JS by default** — add `client:*` islands only when interactivity genuinely requires it.
- Tailwind CSS, tokens only — no hardcoded hex, no inline `style=`.
- Comments explain non-obvious WHY, never narrate WHAT.

## Frontend & responsive conventions (MANDATORY for UI work)

Adopted verbatim from `bbm-public-website` (learned from its real overflow incident #47):

- **Mobile-first authoring.** Base styles target the smallest screen; layer up with `min-width` / Tailwind `sm: md: lg:` prefixes. Never desktop-first with `max-width` walks.
- **One canonical breakpoint ladder** (Tailwind v4 defaults): `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. No ad-hoc px breakpoints.
- **Layout-robustness invariants:** grid/flex tracks holding text use `minmax(0,…)` (never bare `fr`); display headings carry `overflow-wrap: break-word`; no fixed widths that can exceed a 360px viewport; card grids reflow via `repeat(auto-fill, minmax(min(100%, <floor>), 1fr))`.
- **Interactive states required:** every interactive element has visible `:hover`, `:active`, `:focus-visible`.
- Photo galleries: lazy-load, explicit dimensions (no CLS), optimized via `astro:assets`.

## Testing expectations

- `pnpm build` green before any PR.
- **Responsive verification for every UI-affecting PR:** check widths **360, 390, 768, 1024, 1280** and assert zero horizontal page overflow (`scrollWidth - clientWidth <= 0`), no heading spill, no column overlap. Codify as a parametrised Playwright regression (see `bbm-public-website/tests/e2e/home.spec.ts` for the pattern) — eyeballing one width is not verification.
- **Accessibility:** axe pass (`@axe-core/playwright`) per page; no critical/serious violations.
- Content integrity: every year page renders from YAML without build errors; unknown facts are explicit `null`/«нет данных», never copy-pasted from a neighbouring year.

## Session hygiene

- Read this file + the ТЗ before working. Treat handoffs/memory as point-in-time — verify live state (`gh issue list`, actual files) before asserting status.
- Secrets: never in the repo or chat — GitHub Secrets / host-side `.env` only; reference env var NAMES.
- On session end: update DSG2-11 (intermediate or closing comment per BBM Plane workflow).

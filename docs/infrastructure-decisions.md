# Infrastructure decisions & owner-action checklist

> What is decided and live, what still needs Anton personally, and the exact
> GitHub configuration the deploy consumes. Modeled on
> `bbm-public-website/docs/infrastructure-decisions.md`. Owner actions are money,
> accounts, and DNS — everything else runs autonomously (AGENTS.md).

Settled in Issue #5 (hosting + reproducible deploy). The reuse-survey that led
to these choices is a comment on that issue.

## Decided — live, no owner action pending

### 1. Hosting: `tools-prod-tw`, host nginx, pattern «rsync → nginx»

The static build is served by the **host nginx on `tools-prod-tw`** (Timeweb
Cloud, ru-3 Moscow, Zone RF) from `/var/www/new.orthobio.ru/public`.

Reused, not provisioned: the VPS, its nginx + certbot installation, and the
`deploy` account with the forced-command SSH-key idiom already used by
`kb.bbm.academy`. **No new paid resource was created for this site.** The host
already fronts a public Doctor.School site (`proto-app.doctor.school`) next to
the team tooling, so a static vhost there is precedent, not a new pattern.

Why this over the S3 + CDN pattern of `bbm.academy`: this site is replaced by
the Doctor.School platform module around November 2026, and every published URL
has to keep resolving afterwards. nginx gives path-level 301 control; a CDN in
front of an S3 origin does not. That requirement outranks the edge caching we
would gain for a temporary static site whose heavy media is on S3 anyway.

`portal-prod-tw` was considered and rejected: its Caddy runs inside a
`docker compose` stack owned by `bbm-portal`, so hosting here would mean
cross-repo edits to another repository's proxy config plus a restart of the
production CMS proxy.

### 2. TLS: Let's Encrypt via certbot on the host — **live**

The owner added the `new.orthobio.ru` A-record on 2026-07-27 and
`certbot --nginx -d new.orthobio.ru --redirect` issued the certificate the same
day: **ECDSA, expires 2026-10-25**, renewed by the host's existing
`certbot.timer` (active; a `certbot renew --dry-run` for this certificate
succeeds). `https://new.orthobio.ru/` serves the site and `http://` answers
`301` to it.

`certbot --nginx` rewrote the vhost in place — it moved the site onto 443 and
appended the port-80 redirect server. Those lines are **reproduced verbatim in
`infra/nginx/new.orthobio.ru.conf`**, each keeping its `# managed by Certbot`
marker, so the repo and the host do not drift and a re-provision cannot silently
downgrade the live site to HTTP. Renewals do not touch the vhost; only a re-run
of `certbot --nginx` does, and that means reconciling the repo copy again.

### 3. Media: Timeweb S3 `orthobio-media`

Photos and PDFs stay in the bucket provisioned in #13
(`https://s3.twcstorage.ru/orthobio-media/`, public-read). Cache headers were
verified live on the deployed site — objects return
`Cache-Control: public, max-age=31536000, immutable` with correct content types
(`application/pdf`, `image/jpeg`). **No change was needed**; the upload in #13
set them correctly.

Note on what actually travels at runtime: gallery photos are fetched from S3 at
**build time** and emitted as optimised, content-hashed `/_astro/*` images, so a
visitor's browser only hits the bucket for the linked PDFs.

### 4. Cache policy on the site origin

Three tiers, expressed as an nginx `map` on `$uri` rather than per-location
headers (an `add_header` inside a `location` replaces every inherited header,
which would silently drop the security headers):

| What | `Cache-Control` |
| --- | --- |
| `/_astro/*` — content-hashed | `public, max-age=31536000, immutable` |
| stable-named assets (favicons, og-image, fonts) | `public, max-age=3600` |
| HTML documents (default) | `public, max-age=0, must-revalidate` |

### 5. Redirects as data

`infra/redirects.yaml` → `pnpm redirects:build` →
`infra/nginx/redirects.generated.conf` → an nginx snippet installed on the host
by the deploy. The November migration is an edit to the YAML plus a deploy. The
generator validates every entry and refuses anything that could inject nginx
syntax; the host-side installer re-checks the file line by line and rolls back
if `nginx -t` fails, because that snippet is included by a vhost on a host that
also fronts Mattermost and Zitadel.

### 6. CI/CD

`ci.yml` (typecheck → unit → redirect-drift check → build → Playwright
responsive/a11y) gates `deploy.yml` through `workflow_run`, which additionally
requires `conclusion == success` and `head_branch == main`. Actions are pinned
to commit SHAs, `permissions` is `contents: read`, and `concurrency` serialises
deploys without cancelling one mid-rsync. The deploy ends by fetching the live
homepage, `robots.txt`, `sitemap.xml`, and an intentionally unknown route. It
asserts their status, content type, canonical host, indexing state, CSP, and
branded 404 content — a config-only "deploy succeeded" cannot pass.

### 7. SEO essentials and the temporary noindex gate

The vhost sends `X-Robots-Tag: noindex, nofollow`. `orthobio.ru` still serves
the previous site, and two near-identical sites in the index would split it.

The deployed artifact is nevertheless production-ready: `robots.txt` allows
crawling and points at `https://orthobio.ru/sitemap.xml`; that sitemap is built
from the Content Layer and lists the 37 canonical apex routes, never the
temporary hostname or the 404 document. The response header, not a divergent
preview-only artifact, is what keeps `new.orthobio.ru` out of the index. This
means the bytes promoted at cutover are the bytes already verified on preview.

This is **not** guarded by prose alone. While `SITE_HOST=new.orthobio.ru`, the
deploy's live check requires `SITE_INDEXABLE=false` and reads the response
header from the resolve-pinned preview vhost. Issue #6 must add a separate
production vhost without that header, then switch `SITE_HOST=orthobio.ru` and
`SITE_INDEXABLE=true` together. In that mode the same resolve-pinned check
requires the production response to be indexable and requires the live host,
homepage canonical, robots sitemap URL, and sitemap root URL to agree. The
production vhost must redirect `www` to the apex in one hop.

### Switchover checklist (Issue #6)

In this order:

1. Prepare and validate the separate production vhost, document root and TLS
   certificate for `orthobio.ru`/`www` without changing DNS. It omits the
   preview-only `X-Robots-Tag` header and redirects `www` to the apex in one hop.
2. Do not delete the preview `X-Robots-Tag` header from
   `infra/nginx/new.orthobio.ru.conf`. Keep the preview independently reachable
   and non-indexable after launch.
3. When the production vhost is ready, set `SITE_HOST=orthobio.ru` and
   `SITE_INDEXABLE=true` together, then run the deploy. Its `--resolve`-pinned
   smoke reaches our production vhost before DNS changes and refuses a response
   whose indexability, canonical, robots or sitemap names anything else.
4. Re-check `new.orthobio.ru` separately: it must still return
   `X-Robots-Tag: noindex, nofollow`. Check that an unknown production path
   returns the branded document with status `404`.
5. Fill `infra/redirects.yaml` with the map from the old URLs and deploy. For a
   wholesale move, one entry does it: `from: /`, `match: prefix`, `to:` the new
   home. That case renders as a regex location rather than `location ^~ /`,
   which would collide with the vhost's own catch-all, and it spares `/.well-known/`
   so certbot renewals keep working.
6. Review the HSTS `max-age` (below) against whatever the new host serves, so a
   pin set here cannot outlive this hostname.

### 8. Branded 404 and focused CSP

Astro builds `404.html`; nginx maps missing routes to it with `error_page 404`
without changing the original `404` status. The page carries its own
`noindex, nofollow`, no canonical, normal site navigation, and two recovery
links. Playwright covers it at the five canonical widths and runs axe.

The vhost also sends a deliberately focused CSP:
`base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`,
plus legacy `X-Frame-Options: DENY`. A broad `default-src` policy was evaluated
and rejected for this temporary static site: five archive pages contain Astro's
inline module for the Rutube facade, so that policy would need
`script-src 'unsafe-inline'` and advertise stronger protection than it provides.
The focused policy blocks embedding, base-URL injection, forms, and plugin
documents without weakening or breaking the existing page.

### 9. HSTS — added with the certificate

```nginx
add_header Strict-Transport-Security "max-age=86400" always;
```

Deliberately one day, and deliberately never `preload`. This hostname is retired
at the November migration, and a preloaded or year-long pin outlives the site
that set it — browsers would go on forcing HTTPS for a name we no longer control.
A day is still long enough to protect a returning visitor.

It was not added before the certificate existed: an HSTS header sent over plain
HTTP is ignored by browsers, so it would have been decoration.

The pre-certificate comment on Issue #6 that asked to add HSTS is superseded by
this live decision and by the current baseline in the issue body.

## Needs Anton (owner)

### A. ~~One DNS A-record~~ — **DONE 2026-07-27**

`orthobio.ru` is delegated to Beget and we have no Beget API access, so the
`new.orthobio.ru` A-record was the owner's to add — and it is added and
resolving globally. TLS followed immediately (see decision 2), so
**`https://new.orthobio.ru/` is the live temporary URL**. The apex `orthobio.ru`
was not touched; the previous site keeps serving until the switchover.

Nothing is outstanding for the temporary URL. The CI live check still uses a
resolver override rather than plain DNS, deliberately: it verifies *our* host by
name, so it cannot be fooled by a DNS change made elsewhere.

If a different temporary hostname is ever wanted, it is `server_name` in
`infra/nginx/new.orthobio.ru.conf`, the `SITE_HOST` repo Variable, a re-run of
`provision.sh`, and a fresh `certbot --nginx` (after which reconcile the vhost
copy in this repo again).

### B. Domain switchover — Issue #6, deliberately out of scope here

Repointing `orthobio.ru` itself (and the redirects from the old site) is its own
issue and its own owner decision.

## GitHub configuration consumed by the deploy

**Secrets** — set on the **`production` environment**, not at repository level,
so no other job in this repo can read them. Values live in the owner's password
manager and are never printed, committed, or echoed in CI logs.

| Secret | What it is |
| --- | --- |
| `DEPLOY_SSH_KEY` | Private half of the `orthobio-ci-deploy` ed25519 key. Its public half is in `deploy@tools-prod-tw`'s `authorized_keys` behind `command="/usr/local/bin/orthobio-deploy",restrict`, so the key can do exactly two things: rsync into the site directory, and apply the redirect snippet. Verified: an interactive shell and an arbitrary command are both refused. |
| `DEPLOY_HOST` | Address of `tools-prod-tw`. Not a cryptographic secret — it becomes public the moment the A-record exists — but this repository is public, and there is no reason to hand out the origin address of a host that also fronts Mattermost and Zitadel next to a file describing its vhosts, its deploy account and its forced-command layout. Keeping it in the secret store also keeps it out of workflow logs. |
| `DEPLOY_KNOWN_HOSTS` | Pinned host key. Without it the first CI connection would trust whatever answers on that address. |

What the `production` environment does and does not do — worth stating exactly,
so nobody removes a guard believing it is covered here. It **does** keep these
secrets off every other job and workflow in the repo, and its `main`-only
deployment-branch policy **does** fence the manual `workflow_dispatch` arm,
which has no CI gate of its own. It does **not** gate the `workflow_run` arm: a
`workflow_run` job's ref is always the default branch, so a `main`-only policy
passes there regardless of what triggered the run. The fork path is closed by
the four `if:` guards in `deploy.yml` alone.

As of 2026-07-31, the repository accepts **squash merges only** and deletes
merged branches automatically. `main` protection applies to administrators,
requires a PR whose branch is current with `main`, the `verify` check, linear
history, and resolved review conversations; force-push and branch deletion are
blocked. The deploy therefore trusts "current green CI on protected `main`",
not an unreviewed administrator push, as its authority.

GitHub's approving-review count remains zero for a concrete identity
limitation: both the CLI implementer and the mandated independent agent reviewer
publish through `sidorovanthon`, and GitHub does not accept self-approval.
`AGENTS.md` therefore remains the enforceable review contract: the orchestrator
must dispatch `orthobio-pr-reviewer`, its labeled verdict is retained in the PR,
and every `[BLOCKER]`/`[IMPORTANT]` is fixed or answered before merge. Branch
protection still requires the PR boundary and resolved conversations.

Dependabot alerts and security updates, secret scanning, and secret-scanning
push protection are enabled. The API also received requests for non-provider
pattern scanning and validity checks, but this repository reports both as
disabled under the current GitHub organization capabilities. The compensating
controls are push protection, the no-secrets policy in `AGENTS.md`, environment-
scoped deploy secrets, and `pnpm audit` in release-readiness checks.

**Variables** — non-secret, optional, all have working defaults:

| Variable | Default | What it is |
| --- | --- | --- |
| `DEPLOY_USER` | `deploy` | Host account the key belongs to. |
| `SITE_HOST` | `new.orthobio.ru` | Hostname the post-deploy live check requests. |
| `SITE_INDEXABLE` | `false` | Whether the site is supposed to be indexable. The deploy compares it against the live `X-Robots-Tag` and fails on a mismatch — see the switchover checklist. |

## Host-side objects

**Only the two bottom rows are shipped by the deploy.** Everything above them is
host state that a repo edit does **not** propagate: after changing any of those
files, re-run `sh infra/host/provision.sh <ssh-target>` from a workstation whose
key has sudo on the host. That script is idempotent — it is also the way to
check the host still matches the repo.

| Path on `tools-prod-tw` | Source | Installed by |
| --- | --- | --- |
| `/usr/local/bin/orthobio-deploy` | `infra/host/orthobio-deploy` | `provision.sh` — forced command for the CI key: routes to `rrsync` or to the redirect-apply step, refuses everything else. |
| `/usr/local/sbin/orthobio-apply-redirects` | `infra/host/orthobio-apply-redirects` | `provision.sh` — validates the deployed snippet, installs it, reloads nginx, rolls back on `nginx -t` failure. |
| `/etc/nginx/sites-available/new.orthobio.ru` | `infra/nginx/new.orthobio.ru.conf` | `provision.sh`. The repo copy includes certbot's TLS lines verbatim, so overwriting is safe; `provision.sh` refuses only the drift case — host has TLS lines the repo copy lacks — and rolls back the vhost and the `sites-enabled` symlink if `nginx -t` rejects the result. |
| `deploy@…:~/.ssh/authorized_keys` | public half of `DEPLOY_SSH_KEY` | **by hand, once** — one line: `command="/usr/local/bin/orthobio-deploy",restrict ssh-ed25519 … orthobio-ci-deploy`. |
| `/etc/nginx/snippets/orthobio-redirects.conf` | generated from `infra/redirects.yaml` | the deploy, every run. |
| `/var/www/new.orthobio.ru/public` | `dist/` | the deploy, every run. |

**Sudo posture.** `orthobio-apply-redirects` runs via `sudo -n` from the forced
command. No sudoers entry of ours makes that work: the `deploy` account on this
host already carries blanket `NOPASSWD: ALL`, pre-existing and shared with the
other services on the box. A scoped `NOPASSWD` line for this one command would
not tighten anything while the blanket rule stands, so none was added — the
boundary for the CI key is the forced command, not the account. Narrowing the
blanket rule is a host-wide change that belongs to the `bbm` infra repo, not
here.

## Deferred (not needed for a temporary site)

- **Analytics** — none. Yandex Metrica is the ecosystem default if the owner
  wants numbers before November.
- **CDN** — none. A temporary static site on an RF VPS, with media already on S3.
- **Uptime monitoring** — the ecosystem's `mon-prod-tw` blackbox prober could
  take this URL once the DNS record exists; worth doing only if the site is
  expected to matter for longer than the migration.
- **Error monitoring** — no client-side JS to speak of.

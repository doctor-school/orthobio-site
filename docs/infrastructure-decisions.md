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
would gain, for a 4.4 MB / 15-page site whose heavy media is on S3 anyway.

`portal-prod-tw` was considered and rejected: its Caddy runs inside a
`docker compose` stack owned by `bbm-portal`, so hosting here would mean
cross-repo edits to another repository's proxy config plus a restart of the
production CMS proxy.

### 2. TLS: Let's Encrypt via certbot on the host

`certbot --nginx` issues and renews the certificate; the renewal timer is
already active on the host and covers four sibling certificates. TLS directives
live in certbot's own section of the vhost, **not** in
`infra/nginx/new.orthobio.ru.conf`, so a renewal never has to be reconciled
against a repo file. Issuance is blocked on exactly one thing — the DNS record
in the owner checklist below.

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
homepage and asserting `200` plus expected content — a config-only "deploy
succeeded" cannot pass.

### 7. Not indexed while temporary

The vhost sends `X-Robots-Tag: noindex, nofollow`. `orthobio.ru` still serves
the previous site, and two near-identical sites in the index would split it.
**Remove that line at the domain switchover** (Issue #6).

## Needs Anton (owner)

### A. One DNS A-record — the only thing between this and a public HTTPS URL

`orthobio.ru` is delegated to Beget, and we have no Beget API access (records
are added through the UI by the owner — `bbm-kb/ssot/facts/services.yaml`).

- **Action:** in Beget DNS for the `orthobio.ru` zone, add
  `new.orthobio.ru.  A  5.42.108.242`.
- **Cost:** none. The apex `orthobio.ru` is **not** touched — the current site
  keeps serving until the switchover.
- **After it resolves,** run once on the host:
  `sudo certbot --nginx -d new.orthobio.ru --redirect`
  Certbot adds the 443 listener, the certificate, and the 80 → 443 redirect;
  renewal is picked up by the existing timer. Nothing in this repo changes.
- **Until then** the site is reachable, and is verified in CI, by name with a
  resolver override (`curl --resolve new.orthobio.ru:80:<host>`) — the same
  pre-DNS-flip idiom the ecosystem used for the Plane migration (DSO-17).

If the owner prefers a different temporary hostname, it is a one-line change:
`server_name` in `infra/nginx/new.orthobio.ru.conf` and the `SITE_HOST` repo
Variable.

### B. Domain switchover — Issue #6, deliberately out of scope here

Repointing `orthobio.ru` itself (and the redirects from the old site) is its own
issue and its own owner decision.

## GitHub configuration consumed by the deploy

**Secrets** — set on this repository; values live in the owner's password
manager and are never printed, committed, or echoed in CI logs.

| Secret | What it is |
| --- | --- |
| `DEPLOY_SSH_KEY` | Private half of the `orthobio-ci-deploy` ed25519 key. Its public half is in `deploy@tools-prod-tw`'s `authorized_keys` behind `command="/usr/local/bin/orthobio-deploy",restrict`, so the key can do exactly two things: rsync into the site directory, and apply the redirect snippet. Verified: an interactive shell and an arbitrary command are both refused. |
| `DEPLOY_HOST` | Address of `tools-prod-tw`. Kept a secret so the origin coordinates do not show up in workflow logs. |
| `DEPLOY_KNOWN_HOSTS` | Pinned host key. Without it the first CI connection would trust whatever answers on that address. |

**Variables** — non-secret, optional, both have working defaults:

| Variable | Default | What it is |
| --- | --- | --- |
| `DEPLOY_USER` | `deploy` | Host account the key belongs to. |
| `SITE_HOST` | `new.orthobio.ru` | Hostname the post-deploy live check requests. |

## Host-side objects (installed from this repo, `infra/host/`)

| Path on `tools-prod-tw` | Source | Purpose |
| --- | --- | --- |
| `/usr/local/bin/orthobio-deploy` | `infra/host/orthobio-deploy` | Forced command for the CI key: routes to `rrsync` or to the redirect-apply step, refuses everything else. |
| `/usr/local/sbin/orthobio-apply-redirects` | `infra/host/orthobio-apply-redirects` | Validates the deployed snippet, installs it, reloads nginx, rolls back on `nginx -t` failure. |
| `/etc/nginx/sites-available/new.orthobio.ru` | `infra/nginx/new.orthobio.ru.conf` | The vhost (+ certbot's TLS section once the certificate exists). |
| `/etc/nginx/snippets/orthobio-redirects.conf` | generated | The active redirect map. |
| `/var/www/new.orthobio.ru/public` | `dist/` | Document root, mirrored by the deploy. |

## Deferred (not needed for a temporary site)

- **Analytics** — none. Yandex Metrica is the ecosystem default if the owner
  wants numbers before November.
- **CDN** — none. A 4.4 MB static site on an RF VPS, with media already on S3.
- **Uptime monitoring** — the ecosystem's `mon-prod-tw` blackbox prober could
  take this URL once the DNS record exists; worth doing only if the site is
  expected to matter for longer than the migration.
- **Error monitoring** — no client-side JS to speak of.

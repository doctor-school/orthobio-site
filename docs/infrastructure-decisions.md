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

### 7. Not indexed while temporary — with a mechanical gate

The vhost sends `X-Robots-Tag: noindex, nofollow`. `orthobio.ru` still serves
the previous site, and two near-identical sites in the index would split it.

This is **not** guarded by prose alone. The deploy's live check reads the header
off the real response and compares it to the `SITE_INDEXABLE` repo Variable, so
the two can never drift silently: forgetting to remove the header at launch
fails every deploy, and so does removing it without flipping the Variable.

### Switchover checklist (Issue #6)

In this order:

1. Set the `SITE_INDEXABLE` repo Variable to `true`. The next deploy fails —
   that is the gate proving the header is still there.
2. Delete the `add_header X-Robots-Tag …` line from
   `infra/nginx/new.orthobio.ru.conf`, re-run `sh infra/host/provision.sh …`.
   The deploy goes green again.
3. Add `Strict-Transport-Security` (see below) at the same time.
4. Fill `infra/redirects.yaml` with the map from the old URLs and deploy.

### 8. No HSTS yet — deliberate, revisit with TLS

`certbot --nginx --redirect` does not add `Strict-Transport-Security`, and this
vhost is HTTP-only until certbot runs — an HSTS header served over plain HTTP is
ignored by browsers, so adding it now would be decoration. Add it with the
certificate:

```nginx
add_header Strict-Transport-Security "max-age=86400" always;
```

A short `max-age` and **never** `preload`: this hostname is retired in November,
and a preloaded or year-long HSTS pin outlives the site that set it.

## Needs Anton (owner)

### A. One DNS A-record — the only thing between this and a public HTTPS URL

`orthobio.ru` is delegated to Beget, and we have no Beget API access (records
are added through the UI by the owner — `bbm-kb/ssot/facts/services.yaml`).

- **Action:** in Beget DNS for the `orthobio.ru` zone, add an `A` record
  `new.orthobio.ru.` → the IPv4 address of `tools-prod-tw`. The address is in
  the password manager and in the Timeweb Cloud panel; this repo is public, so
  it is deliberately not written down here (see the `DEPLOY_HOST` row below).
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

**Secrets** — set on the **`production` environment**, not at repository level,
so no other job in this repo can read them. Values live in the owner's password
manager and are never printed, committed, or echoed in CI logs.

| Secret | What it is |
| --- | --- |
| `DEPLOY_SSH_KEY` | Private half of the `orthobio-ci-deploy` ed25519 key. Its public half is in `deploy@tools-prod-tw`'s `authorized_keys` behind `command="/usr/local/bin/orthobio-deploy",restrict`, so the key can do exactly two things: rsync into the site directory, and apply the redirect snippet. Verified: an interactive shell and an arbitrary command are both refused. |
| `DEPLOY_HOST` | Address of `tools-prod-tw`. Not a cryptographic secret — it becomes public the moment the A-record exists — but this repository is public, and there is no reason to hand out the origin address of a host that also fronts Mattermost and Zitadel next to a file describing its vhosts, its deploy account and its forced-command layout. Keeping it in the secret store also keeps it out of workflow logs. |
| `DEPLOY_KNOWN_HOSTS` | Pinned host key. Without it the first CI connection would trust whatever answers on that address. |

The `production` environment carries a deployment-branch policy admitting `main`
only. That is the second, independent line of defence behind the `workflow_run`
guards: GitHub will not release these secrets to a run on any other ref,
including a fork's. `main` also has branch protection (PR required, force-push
and deletion blocked, `verify` required), because the deploy trusts "green CI on
main" as its authority.

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
| `/etc/nginx/sites-available/new.orthobio.ru` | `infra/nginx/new.orthobio.ru.conf` | `provision.sh` (+ certbot's TLS section once the certificate exists; `provision.sh` refuses to overwrite the file after certbot has touched it). |
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
- **CDN** — none. A 4.4 MB static site on an RF VPS, with media already on S3.
- **Uptime monitoring** — the ecosystem's `mon-prod-tw` blackbox prober could
  take this URL once the DNS record exists; worth doing only if the site is
  expected to matter for longer than the migration.
- **Error monitoring** — no client-side JS to speak of.

#!/bin/sh
# Install (or re-install) everything this repo owns on the web host.
#
#   sh infra/host/provision.sh <ssh-target>        # e.g. tools-prod-tw
#
# Run from the repo root on a workstation whose SSH key has sudo on the host —
# NOT from CI: the CI key is deliberately confined to `rsync` + `apply-redirects`
# and cannot touch /etc or /usr/local.
#
# This exists because the deploy ships only `dist/` and the generated snippet.
# Everything else here — the vhost, the forced-command wrapper, the redirect
# installer — is host state that a repo edit does NOT propagate on its own, so
# editing one of those files means re-running this script. Idempotent: safe to
# run repeatedly, and the way to verify the host still matches the repo.
set -eu

TARGET=${1:-}
if [ -z "$TARGET" ]; then
    echo "usage: sh infra/host/provision.sh <ssh-target>" >&2
    exit 1
fi

SITE=new.orthobio.ru
ROOT=/var/www/$SITE

echo "==> staging files on $TARGET"
scp infra/host/orthobio-deploy \
    infra/host/orthobio-apply-redirects \
    infra/nginx/$SITE.conf \
    infra/nginx/redirects.generated.conf \
    "$TARGET:/tmp/"

echo "==> installing on $TARGET"
ssh "$TARGET" "set -eu
    sudo -n install -d -o deploy -g deploy -m 0755 $ROOT $ROOT/public
    sudo -n install -o root -g root -m 0755 /tmp/orthobio-deploy /usr/local/bin/orthobio-deploy
    sudo -n install -o root -g root -m 0755 /tmp/orthobio-apply-redirects /usr/local/sbin/orthobio-apply-redirects
    sudo -n install -d -o root -g root -m 0755 /etc/nginx/snippets
    # Seed the snippet only if absent: a live map must not be reverted to empty
    # by a re-provision. Updating it is the deploy's job.
    [ -f /etc/nginx/snippets/orthobio-redirects.conf ] ||
        sudo -n install -o root -g root -m 0644 /tmp/redirects.generated.conf /etc/nginx/snippets/orthobio-redirects.conf
    # The committed vhost carries certbot's TLS lines verbatim (reconciled after
    # issuance), so overwriting it is safe and is how a vhost edit reaches the
    # host. Refuse only the drift case — host has TLS, the repo copy does not —
    # which would silently downgrade a live site to HTTP-only. Both greps are
    # anchored: the file's own header comment mentions ssl_certificate, and a
    # substring match would see itself.
    if sudo -n grep -qE '^[[:space:]]*ssl_certificate' /etc/nginx/sites-available/$SITE 2>/dev/null &&
       ! grep -qE '^[[:space:]]*ssl_certificate' /tmp/$SITE.conf; then
        echo 'provision: the host vhost has TLS directives the repo copy lacks.' >&2
        echo 'Reconcile infra/nginx/$SITE.conf against the host first — refusing to downgrade it to HTTP.' >&2
        exit 1
    fi

    # Remember what to undo if nginx rejects the result: a half-applied vhost
    # left enabled would take the whole host's nginx down at the next unrelated
    # reload (certbot renews on a timer), and this box also fronts Mattermost
    # and Zitadel.
    # if/fi, not \`[ … ] && VAR=1\`: under \`set -e\` a false test ends the script.
    HAD_VHOST=0
    if [ -f /etc/nginx/sites-available/$SITE ]; then
        HAD_VHOST=1
        sudo -n cp -p /etc/nginx/sites-available/$SITE /tmp/$SITE.conf.prev
    fi
    HAD_LINK=0
    if [ -L /etc/nginx/sites-enabled/$SITE ]; then HAD_LINK=1; fi

    sudo -n install -o root -g root -m 0644 /tmp/$SITE.conf /etc/nginx/sites-available/$SITE
    sudo -n ln -sfn /etc/nginx/sites-available/$SITE /etc/nginx/sites-enabled/$SITE

    if ! sudo -n nginx -t; then
        echo 'provision: nginx rejected the config — rolling back' >&2
        if [ \$HAD_LINK = 0 ]; then sudo -n rm -f /etc/nginx/sites-enabled/$SITE; fi
        if [ \$HAD_VHOST = 1 ]; then
            sudo -n install -o root -g root -m 0644 /tmp/$SITE.conf.prev /etc/nginx/sites-available/$SITE
        else
            sudo -n rm -f /etc/nginx/sites-available/$SITE
        fi
        sudo -n nginx -t
        exit 1
    fi

    sudo -n systemctl reload nginx
    rm -f /tmp/orthobio-deploy /tmp/orthobio-apply-redirects /tmp/$SITE.conf /tmp/redirects.generated.conf
    sudo -n rm -f /tmp/$SITE.conf.prev
"

cat <<EOF

Installed. Remaining manual steps, once only:

  1. Authorise the CI deploy key (public half of the DEPLOY_SSH_KEY secret) in
     deploy@<host>:~/.ssh/authorized_keys, as ONE line:

       command="/usr/local/bin/orthobio-deploy",restrict ssh-ed25519 AAAA... orthobio-ci-deploy

     The forced command is the whole security boundary for that key.

  2. After the $SITE A-record exists:

       sudo certbot --nginx -d $SITE --redirect

Note on sudo: the \`deploy\` account on this host already has blanket NOPASSWD
sudo (pre-existing, shared with the other services on the box), which is why
\`sudo -n /usr/local/sbin/orthobio-apply-redirects\` works without a sudoers
entry of our own. Adding a scoped NOPASSWD line would not tighten anything
while the blanket rule stands — see docs/infrastructure-decisions.md.
EOF

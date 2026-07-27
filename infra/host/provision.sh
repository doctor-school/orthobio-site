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
    # certbot writes its TLS directives into sites-available; overwriting the
    # file after certbot has run would drop them. Refuse instead of breaking TLS.
    # Anchored and un-indented: the repo file's own header comment mentions
    # ssl_certificate, and a bare substring match would see itself.
    if sudo -n grep -qE '^[[:space:]]*ssl_certificate' /etc/nginx/sites-available/$SITE 2>/dev/null; then
        echo 'provision: vhost already carries certbot TLS directives — merge by hand, not overwriting' >&2
    else
        sudo -n install -o root -g root -m 0644 /tmp/$SITE.conf /etc/nginx/sites-available/$SITE
    fi
    sudo -n ln -sfn /etc/nginx/sites-available/$SITE /etc/nginx/sites-enabled/$SITE
    sudo -n nginx -t
    sudo -n systemctl reload nginx
    rm -f /tmp/orthobio-deploy /tmp/orthobio-apply-redirects /tmp/$SITE.conf /tmp/redirects.generated.conf
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

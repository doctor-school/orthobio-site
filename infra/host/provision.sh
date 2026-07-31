#!/bin/sh
# Install (or re-install) everything this repo owns on the web host.
#
#   sh infra/host/provision.sh <ssh-target>
#   sh infra/host/provision.sh <ssh-target> --enable-production
#
# The default mode updates the shared release root and preview vhost only.
# Production is enabled explicitly, after the DNS-01 certificate for BOTH
# orthobio.ru and www.orthobio.ru exists. That separation is the TLS safety
# gate before the owner moves public DNS.
#
# Run from the repo root on a workstation whose SSH key has sudo on the host —
# NOT from CI: the CI key is deliberately confined to rsync + apply-redirects.
set -eu

TARGET=${1:-}
MODE=${2:-}

if [ -z "$TARGET" ]; then
    echo "usage: sh infra/host/provision.sh <ssh-target> [--enable-production]" >&2
    exit 1
fi

case "$MODE" in
    "")
        ENABLE_PRODUCTION=0
        ;;
    "--enable-production")
        ENABLE_PRODUCTION=1
        ;;
    *)
        echo "unknown mode: $MODE" >&2
        echo "usage: sh infra/host/provision.sh <ssh-target> [--enable-production]" >&2
        exit 1
        ;;
esac

echo "==> staging files on $TARGET"
scp infra/host/orthobio-deploy \
    infra/host/orthobio-apply-redirects \
    infra/host/orthobio-provision-transaction \
    infra/host/orthobio-seed-release \
    infra/nginx/orthobio-cache-map.conf \
    infra/nginx/new.orthobio.ru.conf \
    infra/nginx/orthobio.ru.conf \
    infra/nginx/redirects.generated.conf \
    "$TARGET:/tmp/"

echo "==> installing on $TARGET (production=$ENABLE_PRODUCTION)"
ssh "$TARGET" "ENABLE_PRODUCTION=$ENABLE_PRODUCTION sh -s" <<'REMOTE'
set -eu

ROOT=/var/www/orthobio-site
LEGACY_ROOT=/var/www/new.orthobio.ru
PREVIEW_SITE=new.orthobio.ru
PRODUCTION_SITE=orthobio.ru
CACHE_MAP=/etc/nginx/conf.d/orthobio-cache-map.conf
PREVIEW_VHOST=/etc/nginx/sites-available/$PREVIEW_SITE
PRODUCTION_VHOST=/etc/nginx/sites-available/$PRODUCTION_SITE
PREVIEW_LINK=/etc/nginx/sites-enabled/$PREVIEW_SITE
PRODUCTION_LINK=/etc/nginx/sites-enabled/$PRODUCTION_SITE
CERT=/etc/letsencrypt/live/$PRODUCTION_SITE/fullchain.pem
CERT_KEY=/etc/letsencrypt/live/$PRODUCTION_SITE/privkey.pem
FORCED_COMMAND=/usr/local/bin/orthobio-deploy
REDIRECT_INSTALLER=/usr/local/sbin/orthobio-apply-redirects
REDIRECT_SNIPPET=/etc/nginx/snippets/orthobio-redirects.conf

# shellcheck source=infra/host/orthobio-provision-transaction
. /tmp/orthobio-provision-transaction

PRODUCTION_ACTIVE=0
if sudo -n test -L "$PRODUCTION_LINK"; then PRODUCTION_ACTIVE=1; fi

# Once production is live, even a default re-provision must keep enforcing the
# certificate invariant before it overwrites the enabled vhost.
if [ "$ENABLE_PRODUCTION" = 1 ] || [ "$PRODUCTION_ACTIVE" = 1 ]; then
    if ! sudo -n test -f "$CERT" || ! sudo -n test -f "$CERT_KEY"; then
        echo "provision: production certificate or key is missing" >&2
        echo "Expected $CERT and $CERT_KEY" >&2
        exit 1
    fi
    if ! sudo -n openssl x509 -in "$CERT" -noout -checkhost orthobio.ru; then
        echo "provision: certificate does not cover orthobio.ru" >&2
        exit 1
    fi
    if ! sudo -n openssl x509 -in "$CERT" -noout -checkhost www.orthobio.ru; then
        echo "provision: certificate does not cover www.orthobio.ru" >&2
        exit 1
    fi
fi

# Refuse to overwrite a live TLS preview with a repo file that lost its
# certificate directives. Header comments mention the directive names, so both
# greps are anchored to actual config lines.
if sudo -n grep -qE '^[[:space:]]*ssl_certificate' "$PREVIEW_VHOST" 2>/dev/null &&
   ! grep -qE '^[[:space:]]*ssl_certificate' /tmp/new.orthobio.ru.conf; then
    echo "provision: the host preview vhost has TLS directives the repo copy lacks" >&2
    exit 1
fi

BACKUP=$(mktemp -d /tmp/orthobio-provision.XXXXXX)

backup_source_exists() {
    sudo -n test -e "$1"
}

copy_backup_source() {
    sudo -n cp -a "$1" "$2"
}

HAD_CACHE=0
HAD_PREVIEW=0
HAD_PRODUCTION=0
HAD_FORCED_COMMAND=0
HAD_REDIRECT_INSTALLER=0
HAD_REDIRECT_SNIPPET=0
HAD_PREVIEW_LINK=0
HAD_PRODUCTION_LINK=0
PREVIEW_LINK_TARGET=
PRODUCTION_LINK_TARGET=
CHANGES_STARTED=0
COMMITTED=0

restore_file() {
    had_file=$1
    backup_name=$2
    destination=$3
    mode=$4

    if [ "$had_file" = 1 ]; then
        sudo -n install -o root -g root -m "$mode" \
            "$BACKUP/$backup_name" \
            "$destination"
    else
        sudo -n rm -f "$destination"
    fi
}

restore_link() {
    had_link=$1
    target=$2
    link=$3

    if [ "$had_link" = 1 ]; then
        sudo -n ln -sfn "$target" "$link"
    else
        sudo -n rm -f "$link"
    fi
}

restore_state() {
    restore_file "$HAD_CACHE" cache-map.conf "$CACHE_MAP" 0644 &&
    restore_file "$HAD_PREVIEW" preview.conf "$PREVIEW_VHOST" 0644 &&
    restore_file "$HAD_PRODUCTION" production.conf "$PRODUCTION_VHOST" 0644 &&
    restore_file "$HAD_FORCED_COMMAND" orthobio-deploy "$FORCED_COMMAND" 0755 &&
    restore_file \
        "$HAD_REDIRECT_INSTALLER" \
        orthobio-apply-redirects \
        "$REDIRECT_INSTALLER" \
        0755 &&
    restore_file \
        "$HAD_REDIRECT_SNIPPET" \
        redirects.conf \
        "$REDIRECT_SNIPPET" \
        0644 &&
    restore_link "$HAD_PREVIEW_LINK" "$PREVIEW_LINK_TARGET" "$PREVIEW_LINK" &&
    restore_link "$HAD_PRODUCTION_LINK" "$PRODUCTION_LINK_TARGET" "$PRODUCTION_LINK"
}

validate_restored_state() {
    sudo -n nginx -t
}

reload_restored_state() {
    sudo -n systemctl reload nginx
}

remove_staged_files() {
    rm -f \
        /tmp/orthobio-deploy \
        /tmp/orthobio-apply-redirects \
        /tmp/orthobio-provision-transaction \
        /tmp/orthobio-seed-release \
        /tmp/orthobio-cache-map.conf \
        /tmp/new.orthobio.ru.conf \
        /tmp/orthobio.ru.conf \
        /tmp/redirects.generated.conf
}

remove_backup() {
    for name in \
        cache-map.conf \
        preview.conf \
        production.conf \
        orthobio-deploy \
        orthobio-apply-redirects \
        redirects.conf
    do
        sudo -n rm -f "$BACKUP/$name"
    done
    sudo -n rmdir "$BACKUP"
}

on_exit() {
    status=$?
    final_status=$status
    trap - EXIT INT TERM
    set +e

    if [ "$CHANGES_STARTED" = 1 ] && [ "$COMMITTED" = 0 ]; then
        echo "provision: applying changes failed — restoring previous host state" >&2
        if ! rollback_transaction; then
            final_status=1
        fi
    else
        if ! remove_backup; then
            echo "provision: could not remove completed transaction backup: $BACKUP" >&2
            final_status=1
        fi
    fi

    remove_staged_files
    exit "$final_status"
}

trap 'exit 130' INT
trap 'exit 143' TERM
trap on_exit EXIT

# Capture every rollback source before the first host mutation. A missing source
# is a normal HAD_*=0 state; a failed copy exits explicitly from backup_file.
if backup_file "$CACHE_MAP" cache-map.conf; then HAD_CACHE=1; fi
if backup_file "$PREVIEW_VHOST" preview.conf; then HAD_PREVIEW=1; fi
if backup_file "$PRODUCTION_VHOST" production.conf; then HAD_PRODUCTION=1; fi
if backup_file "$FORCED_COMMAND" orthobio-deploy; then HAD_FORCED_COMMAND=1; fi
if backup_file "$REDIRECT_INSTALLER" orthobio-apply-redirects; then
    HAD_REDIRECT_INSTALLER=1
fi
if backup_file "$REDIRECT_SNIPPET" redirects.conf; then HAD_REDIRECT_SNIPPET=1; fi
if sudo -n test -L "$PREVIEW_LINK"; then
    HAD_PREVIEW_LINK=1
    PREVIEW_LINK_TARGET=$(sudo -n readlink "$PREVIEW_LINK")
fi
if sudo -n test -L "$PRODUCTION_LINK"; then
    HAD_PRODUCTION_LINK=1
    PRODUCTION_LINK_TARGET=$(sudo -n readlink "$PRODUCTION_LINK")
fi

# Seed the full release tree and its completion marker in a sibling directory,
# then expose it with one same-filesystem rename. An interrupted copy can never
# become the live document root or satisfy a retry.
sudo -n env \
    ROOT="$ROOT" \
    LEGACY_ROOT="$LEGACY_ROOT" \
    SEED_OWNER=deploy:deploy \
    sh /tmp/orthobio-seed-release

CHANGES_STARTED=1
sudo -n install -d -o deploy -g deploy -m 0755 "$ROOT" "$ROOT/public"

sudo -n install -o root -g root -m 0755 /tmp/orthobio-deploy "$FORCED_COMMAND"
sudo -n install -o root -g root -m 0755 /tmp/orthobio-apply-redirects "$REDIRECT_INSTALLER"
sudo -n install -d -o root -g root -m 0755 /etc/nginx/snippets

# Seed only when absent: the deploy owns subsequent redirect-map updates.
if [ ! -f /etc/nginx/snippets/orthobio-redirects.conf ]; then
    sudo -n install -o root -g root -m 0644 \
        /tmp/redirects.generated.conf \
        /etc/nginx/snippets/orthobio-redirects.conf
fi

sudo -n install -o root -g root -m 0644 /tmp/orthobio-cache-map.conf "$CACHE_MAP"
sudo -n install -o root -g root -m 0644 /tmp/new.orthobio.ru.conf "$PREVIEW_VHOST"
sudo -n install -o root -g root -m 0644 /tmp/orthobio.ru.conf "$PRODUCTION_VHOST"
sudo -n ln -sfn "$PREVIEW_VHOST" "$PREVIEW_LINK"

if [ "$ENABLE_PRODUCTION" = 1 ]; then
    sudo -n ln -sfn "$PRODUCTION_VHOST" "$PRODUCTION_LINK"
fi

if ! sudo -n nginx -t; then
    echo "provision: nginx rejected the config" >&2
    exit 1
fi

if ! sudo -n systemctl reload nginx; then
    echo "provision: nginx reload failed" >&2
    exit 1
fi

COMMITTED=1
REMOTE

cat <<EOF

Installed shared release tooling and the preview vhost.

Production enabled: $ENABLE_PRODUCTION

Before the first production enable:

  1. Obtain a certificate named orthobio.ru that covers BOTH orthobio.ru and
     www.orthobio.ru through DNS-01. Public A records do not need to move yet.

  2. Re-run:

       sh infra/host/provision.sh $TARGET --enable-production

  3. Verify both names against the origin with curl --resolve. Only then switch
     SITE_HOST/SITE_INDEXABLE and ask the owner to move Beget DNS.

After DNS propagation, reconfigure the lineage to the nginx authenticator and
run certbot renew --dry-run so automatic renewal no longer depends on manual
DNS challenges. See docs/infrastructure-decisions.md.

The deploy account's pre-existing blanket NOPASSWD sudo is host-wide state.
The CI key remains confined by /usr/local/bin/orthobio-deploy.
EOF

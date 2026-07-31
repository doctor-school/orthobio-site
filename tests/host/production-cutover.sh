#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/orthobio-host-test.XXXXXX")

cleanup() {
    case "$TEST_ROOT" in
        "${TMPDIR:-/tmp}"/orthobio-host-test.*)
            rm -rf "$TEST_ROOT"
            ;;
        *)
            echo "test: refusing to remove unexpected path: $TEST_ROOT" >&2
            exit 1
            ;;
    esac
}
trap cleanup EXIT INT TERM

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

test_partial_seed_retry() {
    root=$TEST_ROOT/release
    legacy=$TEST_ROOT/legacy

    mkdir -p "$legacy/public" "$root.seed.interrupted/public"
    printf 'home\n' > "$legacy/public/index.html"
    printf 'required\n' > "$legacy/public/required.txt"
    printf 'partial\n' > "$root.seed.interrupted/public/index.html"
    printf 'redirects\n' > "$legacy/redirects.conf"

    ROOT=$root \
    LEGACY_ROOT=$legacy \
    SEED_OWNER= \
        sh "$REPO_ROOT/infra/host/orthobio-seed-release"

    [ -f "$root/.orthobio-seed-complete" ] ||
        fail "atomic seed marker is missing"
    [ -f "$root/public/required.txt" ] ||
        fail "retry promoted an incomplete seed"
    [ -f "$root/redirects.conf" ] ||
        fail "redirect seed is missing"
}

test_failed_rollback_retains_backup() {
    BACKUP=$TEST_ROOT/recovery
    REMOVED=0
    mkdir "$BACKUP"
    printf 'original\n' > "$BACKUP/preview.conf"

    restore_state() { return 1; }
    validate_restored_state() { return 0; }
    reload_restored_state() { return 0; }
    remove_backup() {
        REMOVED=1
        rm -f "$BACKUP/preview.conf"
        rmdir "$BACKUP"
    }

    # shellcheck source=../../infra/host/orthobio-provision-transaction
    . "$REPO_ROOT/infra/host/orthobio-provision-transaction"

    if rollback_transaction 2> "$TEST_ROOT/rollback.err"; then
        fail "failed restore was reported as successful"
    fi
    [ "$REMOVED" = 0 ] || fail "failed rollback deleted its backup"
    [ -f "$BACKUP/preview.conf" ] ||
        fail "failed rollback did not retain recovery material"
    grep -Fq "$BACKUP" "$TEST_ROOT/rollback.err" ||
        fail "failed rollback did not report retained backup path"
}

test_successful_rollback_cleans_backup() {
    BACKUP=$TEST_ROOT/recovery-success
    REMOVED=0
    mkdir "$BACKUP"
    printf 'original\n' > "$BACKUP/preview.conf"

    restore_state() { return 0; }
    validate_restored_state() { return 0; }
    reload_restored_state() { return 0; }
    remove_backup() {
        REMOVED=1
        rm -f "$BACKUP/preview.conf"
        rmdir "$BACKUP"
    }

    if rollback_transaction; then
        :
    else
        fail "successful rollback was reported as failed"
    fi
    [ "$REMOVED" = 1 ] || fail "successful rollback retained stale backup"
    [ ! -e "$BACKUP" ] || fail "successful rollback did not clean backup"
}

test_partial_seed_retry
test_failed_rollback_retains_backup
test_successful_rollback_cleans_backup

echo "Host production-cutover tests: OK"

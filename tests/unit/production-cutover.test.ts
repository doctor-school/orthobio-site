import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('production cutover host tooling', () => {
  const forcedCommand = readFileSync('infra/host/orthobio-deploy', 'utf8');
  const redirectInstaller = readFileSync(
    'infra/host/orthobio-apply-redirects',
    'utf8',
  );
  const provision = readFileSync('infra/host/provision.sh', 'utf8');
  const seedRelease = readFileSync(
    'infra/host/orthobio-seed-release',
    'utf8',
  );
  const transaction = readFileSync(
    'infra/host/orthobio-provision-transaction',
    'utf8',
  );

  it('confines CI writes to the hostname-neutral release root', () => {
    expect(forcedCommand).toContain('DEPLOY_ROOT=/var/www/orthobio-site');
    expect(redirectInstaller).toContain(
      'SRC=/var/www/orthobio-site/redirects.conf',
    );
    expect(forcedCommand).not.toContain('/var/www/new.orthobio.ru');
    expect(redirectInstaller).not.toContain('/var/www/new.orthobio.ru');
  });

  it('keeps production disabled until a certificate for apex and www exists', () => {
    expect(provision).toContain('--enable-production');
    expect(provision).toContain(
      'CERT=/etc/letsencrypt/live/$PRODUCTION_SITE/fullchain.pem',
    );
    expect(provision).toMatch(/openssl x509 .* -checkhost orthobio\.ru/);
    expect(provision).toMatch(/openssl x509 .* -checkhost www\.orthobio\.ru/);
  });

  it('installs the cache map once at nginx http scope', () => {
    expect(provision).toContain(
      '/etc/nginx/conf.d/orthobio-cache-map.conf',
    );
  });

  it('rolls back every host-owned object when validation or reload fails', () => {
    expect(provision).toContain('trap on_exit EXIT');
    expect(provision).toContain('restore_state');
    expect(provision).toContain('"$HAD_REDIRECT_SNIPPET"');
    expect(provision).toContain(
      'restore_link "$HAD_PRODUCTION_LINK"',
    );
    expect(provision).toContain('if ! rollback_transaction; then');
    expect(transaction).toContain(
      'rollback failed; recovery files retained at $BACKUP',
    );
    expect(provision.indexOf('sudo -n systemctl reload nginx')).toBeLessThan(
      provision.lastIndexOf('COMMITTED=1'),
    );
  });

  it('promotes a completed release seed with one directory rename', () => {
    expect(provision).toContain('sh /tmp/orthobio-seed-release');
    expect(seedRelease).toContain('STAGE=$(mktemp -d "$ROOT.seed.XXXXXX")');
    expect(seedRelease).toContain(': > "$STAGE/.orthobio-seed-complete"');
    expect(seedRelease).toContain('mv -T "$STAGE" "$ROOT"');
    expect(seedRelease).toContain('refusing unmarked release root');
  });
});

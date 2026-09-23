/**
 * SmartCaptcha site-key selection (Issue #81).
 *
 * Preview (`new.orthobio.ru`) and production (`orthobio.ru`) are deployed from
 * the same build bytes, so the key cannot be fixed at build time: both keys are
 * printed into the page and the browser picks one by hostname. Only the
 * production hosts get the production key — every other host (preview,
 * localhost, an unexpected mirror) gets the preview key, so a stray host can
 * never spend or leak the production captcha's quota. An empty result means
 * «no captcha on this host»; the other environment's key is never borrowed,
 * because a key only validates on the hosts registered for it in Yandex Cloud.
 */

export const PRODUCTION_HOSTS = ['orthobio.ru', 'www.orthobio.ru'] as const;

export interface SitekeyPair {
  prod: string;
  preview: string;
}

export function pickSitekey(hostname: string, keys: SitekeyPair): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  const isProduction = (PRODUCTION_HOSTS as readonly string[]).includes(host);
  return (isProduction ? keys.prod : keys.preview).trim();
}

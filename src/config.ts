/**
 * Everything this service needs to know, read once from the environment.
 *
 * Nothing here is a secret except PUBLIC_PAGES_KEY, and that only buys a
 * bigger rate-limit bucket on the API's public routes (see the API's
 * src/config/rate-limit.ts). Every other value is published by this service
 * anyway, in its pages or its .well-known files.
 */
export interface Config {
  /** Where the Kyron API answers, without a trailing slash. */
  apiUrl: string;

  /** Sent to the API as X-Kyron-Pages-Key. Empty means none. */
  pagesKey: string;

  /**
   * The address links are written with, as https://host, without a trailing
   * slash. Canonical URLs and cards use it, so a page reached through
   * Render's own *.onrender.com address still names the real one.
   */
  siteUrl: string;

  /** The Android app's package name. */
  androidPackage: string;

  /**
   * SHA-256 fingerprints of the certificates the Android app is signed with,
   * as Play Console shows them (App integrity, App signing). Without one,
   * /.well-known/assetlinks.json is not served and Android will not open
   * links in the app on its own.
   */
  androidFingerprints: string[];

  /** TEAMID.bundle.id for each iOS app. None until there is an iOS app. */
  iosAppIds: string[];

  /** Where to get the app. */
  playUrl: string;
  appStoreUrl: string | null;

  /** The legal pages, linked from every page's foot. */
  termsUrl: string;
  privacyUrl: string;

  /**
   * Where Report on a page writes to: the inbox the published terms name
   * for reports. A page anybody can open must say how to get something
   * taken down.
   */
  reportEmail: string;

  port: number;
}

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const IOS_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function httpsUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a URL, and is "${raw}".`);
  }
  // http only for a local API during development: everything a visitor is
  // sent to, or a card is drawn from, is https.
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} must be https, and is "${raw}".`);
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Reads the configuration, refusing to start on a value that is wrong rather
 * than serving with it: a mistyped fingerprint would publish an
 * assetlinks.json that verifies nothing, and nobody would know why links
 * stopped opening the app.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fingerprints = list(env.ANDROID_CERT_SHA256).map((f) => f.toUpperCase());
  for (const f of fingerprints) {
    if (!FINGERPRINT.test(f)) {
      throw new Error(
        `ANDROID_CERT_SHA256 holds "${f}", which is not a SHA-256 ` +
          'fingerprint (32 pairs of hex digits separated by colons).',
      );
    }
  }
  const iosAppIds = list(env.IOS_APP_IDS);
  for (const id of iosAppIds) {
    if (!IOS_APP_ID.test(id)) {
      throw new Error(`IOS_APP_IDS holds "${id}", which is not TEAMID.bundle.id.`);
    }
  }

  const pagesKey = (env.PUBLIC_PAGES_KEY ?? '').trim();
  if (pagesKey.length > 0 && pagesKey.length < 32) {
    throw new Error(
      'PUBLIC_PAGES_KEY is shorter than 32 characters, and the API ignores a ' +
        'key that short. Generate one with: openssl rand -hex 32',
    );
  }

  const reportEmail = env.REPORT_EMAIL ?? 'spidroidtechnologiesinc@gmail.com';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)) {
    throw new Error(`REPORT_EMAIL must be an email address, and is "${reportEmail}".`);
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, and is "${env.PORT}".`);
  }

  const androidPackage = env.ANDROID_PACKAGE ?? 'so.kyron.app';

  return {
    apiUrl: httpsUrl('API_URL', env.API_URL ?? 'https://kyron-47r6.onrender.com'),
    pagesKey,
    siteUrl: httpsUrl('SITE_URL', env.SITE_URL ?? 'https://kyron-links.onrender.com'),
    androidPackage,
    androidFingerprints: fingerprints,
    iosAppIds,
    playUrl: httpsUrl(
      'PLAY_URL',
      env.PLAY_URL ??
        `https://play.google.com/store/apps/details?id=${androidPackage}`,
    ),
    appStoreUrl: env.APP_STORE_URL
      ? httpsUrl('APP_STORE_URL', env.APP_STORE_URL)
      : null,
    termsUrl: httpsUrl(
      'TERMS_URL',
      env.TERMS_URL ?? 'https://kyron-terms-and-privacy.onrender.com/terms.html',
    ),
    privacyUrl: httpsUrl(
      'PRIVACY_URL',
      env.PRIVACY_URL ??
        'https://kyron-terms-and-privacy.onrender.com/privacy.html',
    ),
    reportEmail,
    port,
  };
}

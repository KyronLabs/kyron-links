import { describe, expect, it, vi } from 'vitest';

import type { Api, Lookup, PublicCommunity, PublicPost, PublicProfile } from '../src/api.js';
import { createApp, SECURITY_HEADERS } from '../src/app.js';
import { loadAssets } from '../src/assets.js';
import { readConfig } from '../src/config.js';
import { summary } from '../src/render.js';

const POST_ID = '7d5d3c2a-1b0e-4f7a-9c1d-2e3f4a5b6c7d';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605';

function post(over: Partial<PublicPost> = {}): PublicPost {
  return {
    id: POST_ID,
    content: 'First light over the harbour.',
    createdAt: '2026-11-05T08:00:00.000Z',
    author: { name: 'Ada', username: 'ada', verified: true, avatarUrl: 'https://cdn.example/ada.jpg' },
    community: null,
    media: [],
    hasVoice: false,
    stats: { likes: 1200, comments: 1, reposts: 0 },
    ...over,
  };
}

const profile: PublicProfile = {
  id: POST_ID,
  name: 'Ada',
  username: 'ada',
  verified: false,
  avatarUrl: null,
  bio: 'Sails small boats.',
  coverUrl: null,
  stats: { followers: 3, following: 4, posts: 5 },
};

const community: PublicCommunity = {
  id: POST_ID,
  slug: 'sailing',
  name: 'Sailing',
  description: 'Boats, wind, water.',
  avatarUrl: null,
  bannerUrl: null,
  members: 42,
};

function fakeApi(over: Partial<Record<keyof Api, Lookup<unknown>>> = {}) {
  const api = {
    post: vi.fn(async () => (over.post ?? { kind: 'found', value: post() }) as Lookup<PublicPost>),
    profile: vi.fn(async () => (over.profile ?? { kind: 'found', value: profile }) as Lookup<PublicProfile>),
    community: vi.fn(
      async () => (over.community ?? { kind: 'found', value: community }) as Lookup<PublicCommunity>,
    ),
  };
  return api;
}

const config = readConfig({ SITE_URL: 'https://kyron.example', API_URL: 'https://api.example' });

function appWith(api: Api, env: NodeJS.ProcessEnv = {}) {
  const c = readConfig({ SITE_URL: 'https://kyron.example', API_URL: 'https://api.example', ...env });
  return createApp(c, api, loadAssets());
}

async function get(app: ReturnType<typeof createApp>, path: string, ua = DESKTOP) {
  const res = await app.request(path, { headers: { 'user-agent': ua } });
  return { res, body: await res.text() };
}

describe('a shared post', () => {
  it('is a page with the card the chat apps draw', async () => {
    const { res, body } = await get(appWith(fakeApi()), `/post/${POST_ID}`);
    expect(res.status).toBe(200);
    expect(body).toContain('<title>Ada (@ada) on Kyron</title>');
    expect(body).toContain('<meta property="og:description" content="First light over the harbour.">');
    expect(body).toContain(`<link rel="canonical" href="https://kyron.example/post/${POST_ID}">`);
    expect(body).toContain('<meta property="og:image" content="https://cdn.example/ada.jpg">');
    expect(body).toContain('<meta name="twitter:card" content="summary">');
    expect(body).toContain('1.2K likes');
    expect(body).toContain('aria-label="Verified"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('draws a large card from the post’s own picture', async () => {
    const api = fakeApi({
      post: {
        kind: 'found',
        value: post({
          media: [
            { kind: 'IMAGE', url: 'https://cdn.example/a.jpg', thumbnailUrl: null, width: 1200, height: 800, alt: 'A harbour' },
          ],
        }),
      },
    });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).toContain('<meta property="og:image" content="https://cdn.example/a.jpg">');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain('width="1200" height="800"');
    expect(body).toContain('alt="A harbour"');
  });

  it('shows what somebody typed as text, never as markup', async () => {
    const api = fakeApi({
      post: {
        kind: 'found',
        value: post({
          content: '<script>alert(1)</script> "quoted" & <img src=x onerror=alert(2)>',
          author: { name: '</title><script>x()</script>', username: 'ada', verified: false, avatarUrl: null },
        }),
      },
    });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('&quot;quoted&quot; &amp;');
    expect(body).toContain('&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;');
  });

  it('never puts an address that is not https into a page', async () => {
    const api = fakeApi({
      post: {
        kind: 'found',
        value: post({
          author: { name: 'Ada', username: 'ada', verified: false, avatarUrl: 'javascript:alert(1)' },
          media: [
            { kind: 'IMAGE', url: 'data:image/svg+xml,<svg onload=alert(1)>', thumbnailUrl: null, width: null, height: null, alt: null },
            { kind: 'VIDEO', url: 'http://plain.example/v.mp4', thumbnailUrl: 'javascript:x', width: null, height: null, alt: null },
          ],
        }),
      },
    });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).not.toContain('javascript:');
    expect(body).not.toContain('data:image');
    expect(body).not.toContain('http://plain.example');
    // With nothing usable, the card falls back to Kyron's own.
    expect(body).toContain('<meta property="og:image" content="https://kyron.example/static/card.png">');
  });

  it('says a voice note is there', async () => {
    const api = fakeApi({ post: { kind: 'found', value: post({ hasVoice: true }) } });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).toContain('voice note');
  });

  it('does not ask the API about an id that could not be a post', async () => {
    const api = fakeApi();
    for (const bad of ['123', 'not-a-uuid', `${POST_ID}x`, '..%2F..%2Fadmin']) {
      const { res, body } = await get(appWith(api), `/post/${bad}`);
      expect(res.status).toBe(404);
      expect(body).toContain('noindex');
    }
    expect(api.post).not.toHaveBeenCalled();
  });

  it('is a 404, kept out of search, when it has gone', async () => {
    const { res, body } = await get(appWith(fakeApi({ post: { kind: 'missing' } })), `/post/${POST_ID}`);
    expect(res.status).toBe(404);
    expect(body).toContain('<meta name="robots" content="noindex">');
    expect(body).toContain('Nothing here');
  });

  it('is a 503 that nobody caches when the API is away', async () => {
    const { res, body } = await get(appWith(fakeApi({ post: { kind: 'down' } })), `/post/${POST_ID}`);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('30');
    expect(body).toContain("can't be reached");
  });
});

describe('getting into the app', () => {
  it('on Android, opens the app, or Play when it is not installed', async () => {
    const { res, body } = await get(appWith(fakeApi()), `/post/${POST_ID}`, ANDROID);
    expect(body).toContain(
      `href="intent://kyron.example/post/${POST_ID}#Intent;scheme=https;package=so.kyron.app;` +
        'S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dso.kyron.app;end"',
    );
    expect(body).toContain('Open in Kyron');
    expect(res.headers.get('vary')).toBe('User-Agent');
  });

  it('elsewhere, offers the store and says the app is where it lives', async () => {
    const { body } = await get(appWith(fakeApi()), `/post/${POST_ID}`, DESKTOP);
    expect(body).not.toContain('intent://');
    expect(body).toContain('Get Kyron on Google Play');
    expect(body).toContain('Open this link on your Android phone');
  });
});

describe('a shared profile', () => {
  it('is at /@handle', async () => {
    const api = fakeApi();
    const { res, body } = await get(appWith(api), '/@ada');
    expect(res.status).toBe(200);
    expect(api.profile).toHaveBeenCalledWith('ada');
    expect(body).toContain('<title>Ada (@ada) on Kyron</title>');
    expect(body).toContain('Sails small boats.');
    expect(body).toContain('<link rel="canonical" href="https://kyron.example/@ada">');
  });

  it('by id, moves to its handle: one address per person', async () => {
    const { res } = await get(appWith(fakeApi()), `/u/${POST_ID}`);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/@ada');
  });

  it('by id, stays put for an account with no handle', async () => {
    const api = fakeApi({ profile: { kind: 'found', value: { ...profile, username: null } } });
    const { res, body } = await get(appWith(api), `/u/${POST_ID}`);
    expect(res.status).toBe(200);
    expect(body).toContain(`/u/${POST_ID}`);
  });

  it('is not asked for with a name no account could have', async () => {
    const api = fakeApi();
    for (const bad of ['/@', '/@a%20b', "/@o'neil", `/@${'x'.repeat(65)}`, '/ada']) {
      const { res } = await get(appWith(api), bad);
      expect(res.status).toBe(404);
    }
    expect(api.profile).not.toHaveBeenCalled();
  });
});

describe('a shared community', () => {
  it('is at /c/slug', async () => {
    const { res, body } = await get(appWith(fakeApi()), '/c/sailing');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>Sailing on Kyron</title>');
    expect(body).toContain('42 members');
  });
});

describe('every response', () => {
  it('carries the security headers, found or not', async () => {
    const app = appWith(fakeApi({ post: { kind: 'missing' } }));
    for (const path of ['/', `/post/${POST_ID}`, '/nowhere', '/static/site.css', '/healthz']) {
      const { res } = await get(app, path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(name), `${name} on ${path}`).toBe(value);
      }
    }
  });

  it('allows no script at all', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('has no inline style for that policy to block', async () => {
    const { body } = await get(appWith(fakeApi()), `/post/${POST_ID}`);
    expect(body).not.toMatch(/style=/);
    expect(body).not.toMatch(/<style/);
    expect(body).not.toMatch(/<script/);
  });

  it('is to a read: anything but GET and HEAD is refused', async () => {
    const app = appWith(fakeApi());
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await app.request(`/post/${POST_ID}`, { method });
      expect(res.status).toBe(405);
    }
  });
});

describe('app links', () => {
  const fingerprint = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');

  it('assetlinks.json is not served until there is a fingerprint to put in it', async () => {
    const { res } = await get(appWith(fakeApi()), '/.well-known/assetlinks.json');
    expect(res.status).toBe(404);
  });

  it('assetlinks.json names the package and the signing certificate', async () => {
    const app = appWith(fakeApi(), { ANDROID_CERT_SHA256: fingerprint.toLowerCase() });
    const { res, body } = await get(app, '/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(body)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'so.kyron.app',
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ]);
  });

  it('refuses to start with a fingerprint that is not one', () => {
    expect(() => readConfig({ ANDROID_CERT_SHA256: 'AB:CD' })).toThrow(/ANDROID_CERT_SHA256/);
  });

  it('the iOS file waits for an iOS app, then names its paths', async () => {
    expect((await get(appWith(fakeApi()), '/.well-known/apple-app-site-association')).res.status).toBe(404);
    const app = appWith(fakeApi(), { IOS_APP_IDS: 'ABCDE12345.so.kyron.app' });
    const { body } = await get(app, '/.well-known/apple-app-site-association');
    expect(JSON.parse(body).applinks.details[0].appIDs).toEqual(['ABCDE12345.so.kyron.app']);
  });
});

describe('configuration', () => {
  it('refuses an address that is not https', () => {
    expect(() => readConfig({ SITE_URL: 'http://kyron.example' })).toThrow(/SITE_URL/);
    expect(() => readConfig({ API_URL: 'ftp://x' })).toThrow(/API_URL/);
  });

  it('allows a local API over http, for development', () => {
    expect(readConfig({ API_URL: 'http://localhost:3000' }).apiUrl).toBe('http://localhost:3000');
  });

  it('refuses a pages key the API would ignore', () => {
    expect(() => readConfig({ PUBLIC_PAGES_KEY: 'short' })).toThrow(/32 characters/);
  });

  it('drops a trailing slash so addresses are not doubled', () => {
    expect(config.siteUrl).toBe('https://kyron.example');
    expect(readConfig({ SITE_URL: 'https://kyron.example///' }).siteUrl).toBe('https://kyron.example');
  });
});

describe('a card’s description', () => {
  it('is whitespace folded and cut at a word', () => {
    expect(summary('a\n\n  b\tc')).toBe('a b c');
    const long = 'word '.repeat(100);
    const cut = summary(long, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith('word…')).toBe(true);
  });
});

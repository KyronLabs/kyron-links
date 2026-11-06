import { describe, expect, it, vi } from 'vitest';

import type {
  Api,
  Lookup,
  PublicComment,
  PublicCommunity,
  PublicPost,
  PublicProfile,
} from '../src/api.js';
import { createApp, SECURITY_HEADERS } from '../src/app.js';
import { loadAssets } from '../src/assets.js';
import { readConfig } from '../src/config.js';
import { displayUrl, pollBlock, richText, summary } from '../src/render.js';

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
    mediaCount: 0,
    hasVoice: false,
    stats: { likes: 1200, comments: 1, reposts: 0 },
    poll: null,
    quoted: null,
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
  recent: [post({ id: 'aaaaaaaa-0000-4000-8000-000000000001', content: 'An older one' })],
};

const community: PublicCommunity = {
  id: POST_ID,
  slug: 'sailing',
  name: 'Sailing',
  description: 'Boats, wind, water.',
  avatarUrl: null,
  bannerUrl: null,
  members: 42,
  recent: [],
};

const COMMENT_ID = '11111111-2222-4333-8444-555555555555';
const comment: PublicComment = {
  id: COMMENT_ID,
  content: 'Lovely light, @ada.',
  createdAt: '2026-11-05T09:00:00.000Z',
  author: { name: 'Ben', username: 'ben', verified: false, avatarUrl: null },
  media: [],
  stats: { likes: 2, replies: 1 },
  post: post(),
};

function fakeApi(over: Partial<Record<keyof Api, Lookup<unknown>>> = {}) {
  const api = {
    post: vi.fn(async () => (over.post ?? { kind: 'found', value: post() }) as Lookup<PublicPost>),
    profile: vi.fn(async () => (over.profile ?? { kind: 'found', value: profile }) as Lookup<PublicProfile>),
    community: vi.fn(
      async () => (over.community ?? { kind: 'found', value: community }) as Lookup<PublicCommunity>,
    ),
    comment: vi.fn(
      async () => (over.comment ?? { kind: 'found', value: comment }) as Lookup<PublicComment>,
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

  it('says how many more pictures there are than it shows', async () => {
    const picture = { kind: 'IMAGE' as const, url: 'https://cdn.example/a.jpg', thumbnailUrl: null, width: null, height: null, alt: null };
    const api = fakeApi({
      post: { kind: 'found', value: post({ media: [picture, picture, picture, picture], mediaCount: 8 }) },
    });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).toContain('<span class="more-count" aria-label="4 more in the app">+4</span>');
    expect(body.match(/class="tile/g)).toHaveLength(4);
  });

  it('says nothing more when it shows them all', async () => {
    const picture = { kind: 'IMAGE' as const, url: 'https://cdn.example/a.jpg', thumbnailUrl: null, width: null, height: null, alt: null };
    const api = fakeApi({ post: { kind: 'found', value: post({ media: [picture, picture], mediaCount: 2 }) } });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).not.toContain('more-count');
  });

  it('shows a poll’s results as bars, with no inline style', async () => {
    const api = fakeApi({
      post: {
        kind: 'found',
        value: post({
          content: 'Tea or coffee?',
          poll: {
            options: [
              { text: 'Tea', votes: 3 },
              { text: 'Coffee <b>', votes: 1 },
            ],
            totalVotes: 4,
            closesAt: '2020-01-01T00:00:00.000Z',
          },
        }),
      },
    });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).toContain('<progress max="4" value="3">75%</progress>');
    expect(body).toContain('Coffee &lt;b&gt;');
    expect(body).toContain('4 votes · Final results');
    expect(body).toContain('class="option top"');
    expect(body).not.toMatch(/style=/);
  });

  it('says when an open poll closes', () => {
    const open = pollBlock(
      { options: [{ text: 'A', votes: 0 }], totalVotes: 0, closesAt: '2026-12-01T18:30:00.000Z' },
      new Date('2026-11-06T00:00:00Z'),
    );
    const text = String(open);
    expect(text).toContain('0 votes · Open until 1 Dec');
    expect(text).toContain('<progress max="1" value="0">0%</progress>');
  });

  it('shows the post it quotes, as a link to that post', async () => {
    const api = fakeApi({
      post: {
        kind: 'found',
        value: post({
          quoted: {
            id: 'bbbbbbbb-0000-4000-8000-000000000002',
            content: 'The original <i>',
            createdAt: '2026-11-01T00:00:00.000Z',
            author: { name: 'Ben', username: 'ben', verified: false, avatarUrl: null },
            media: [],
          },
        }),
      },
    });
    const { body } = await get(appWith(api), `/post/${POST_ID}`);
    expect(body).toContain('<a class="quote" href="/post/bbbbbbbb-0000-4000-8000-000000000002">');
    expect(body).toContain('The original &lt;i&gt;');
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

  it('lists recent posts, each a link to its page', async () => {
    const { body } = await get(appWith(fakeApi()), '/@ada');
    expect(body).toContain('Recent posts');
    expect(body).toContain('<a class="item" href="/post/aaaaaaaa-0000-4000-8000-000000000001">');
    expect(body).toContain('An older one');
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

describe('a shared comment', () => {
  it('is at /comment/id, with the post it answers', async () => {
    const { res, body } = await get(appWith(fakeApi()), `/comment/${COMMENT_ID}`);
    expect(res.status).toBe(200);
    expect(body).toContain('<title>Ben (@ben) on Kyron</title>');
    expect(body).toContain('Replying to <a href="/@ada">@ada</a>');
    expect(body).toContain(`<a class="item" href="/post/${POST_ID}">`);
    expect(body).toContain('1 reply');
  });

  it('under the old /c/ address, moves to /comment/', async () => {
    const api = fakeApi({ community: { kind: 'missing' } });
    const { res } = await get(appWith(api), `/c/${COMMENT_ID}`);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`/comment/${COMMENT_ID}`);
  });

  it('a community slug is never tried as a comment', async () => {
    const api = fakeApi({ community: { kind: 'missing' } });
    const { res } = await get(appWith(api), '/c/sailing');
    expect(res.status).toBe(404);
    expect(api.comment).not.toHaveBeenCalled();
  });

  it('is not asked for with an id that could not be one', async () => {
    const api = fakeApi();
    const { res } = await get(appWith(api), '/comment/nope');
    expect(res.status).toBe(404);
    expect(api.comment).not.toHaveBeenCalled();
  });
});

describe('a shared community', () => {
  it('is at /c/slug', async () => {
    const { res, body } = await get(appWith(fakeApi()), '/c/sailing');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>Sailing on Kyron</title>');
    expect(body).toContain('42 members');
    expect(body).toContain('Nothing has been posted here yet.');
  });
});

describe('a post’s text', () => {
  const render = (text: string) => String(richText(text));

  it('links mentions to their profiles, and addresses to themselves', () => {
    expect(render('hi @ada.')).toBe('hi <a class="mention" href="/@ada">@ada</a>.');
    expect(render('see https://example.com/a/b?c=1, ok')).toBe(
      'see <a class="link" href="https://example.com/a/b?c=1" rel="nofollow ugc noopener noreferrer">example.com/a/b?c=1</a>, ok',
    );
  });

  it('leaves an email address alone', () => {
    expect(render('mail ada@example.com')).toBe('mail ada@example.com');
  });

  it('never links anything but http and https', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example']) {
      expect(render(text)).not.toContain('<a');
    }
  });

  it('escapes what is around and inside the links', () => {
    const out = render('<b>hi</b> https://x.example/"onmouseover=alert(1) @a<b');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('"onmouseover');
    expect(out).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('shows a long address cut short', () => {
    expect(displayUrl('https://www.example.com/' + 'a'.repeat(100))).toHaveLength(32);
    expect(displayUrl('https://www.example.com/x')).toBe('example.com/x');
  });
});

describe('every page', () => {
  it('says how to report it', async () => {
    const { body } = await get(appWith(fakeApi()), `/post/${POST_ID}`);
    expect(body).toContain(
      `href="mailto:spidroidtechnologiesinc@gmail.com?subject=Report%3A%20https%3A%2F%2Fkyron.example%2Fpost%2F${POST_ID}`,
    );
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

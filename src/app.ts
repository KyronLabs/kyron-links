import { Hono, type Context } from 'hono';

import type { Api, Lookup } from './api.js';
import type { Config } from './config.js';
import {
  commentPage,
  communityPage,
  downPage,
  homePage,
  missingPage,
  openIn,
  postPage,
  profilePage,
} from './render.js';

/** A file served from /static, held in memory. */
export interface Asset {
  body: Uint8Array;
  type: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What the API accepts as a handle or a slug; anything else is not asked. */
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Every response says the same things about itself.
 *
 * No script runs on any page, so the policy allows none, and the page cannot
 * be framed, post a form, or load a style from anywhere but here. Pictures
 * and clips come from wherever the post's are stored, which is https.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self' https:; media-src https:; " +
    "style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function createApp(config: Config, api: Api, assets: Map<string, Asset>) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    // Read-only, all of it. Hono answers HEAD from the GET routes.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.text('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      c.header(name, value);
    }
  });

  const isAndroid = (c: Context) => /Android/i.test(c.req.header('user-agent') ?? '');

  /**
   * A page for what a lookup came to. Pages vary with the visitor's phone
   * (the Open in Kyron button is for Android only), so caches are told so.
   */
  async function page<T>(
    c: Context,
    what: string,
    lookup: Lookup<T>,
    render: (value: T) => ReturnType<typeof postPage>,
  ) {
    c.header('Vary', 'User-Agent');
    if (lookup.kind === 'found') {
      c.header('Cache-Control', 'public, max-age=60');
      return c.html(await render(lookup.value));
    }
    if (lookup.kind === 'missing') return missing(c, what);
    c.header('Cache-Control', 'no-store');
    c.header('Retry-After', '30');
    // Why, in a few words with nothing secret in them, so a 503 can be
    // understood from outside without the server's logs.
    c.header('X-Upstream', lookup.reason ?? 'down');
    return c.html(await downPage(config, c.req.path), 503);
  }

  async function missing(c: Context, what: string) {
    c.header('Cache-Control', 'public, max-age=60');
    return c.html(await missingPage(config, c.req.path, what), 404);
  }

  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.text('ok');
  });

  app.get('/robots.txt', (c) => {
    c.header('Cache-Control', 'public, max-age=86400');
    return c.text('User-agent: *\nAllow: /\n');
  });

  // What Android checks before it will open this site's links in the app
  // without asking. Without a fingerprint there is nothing true to say, so
  // nothing is served: an empty list would verify nothing and look as if it
  // should.
  app.get('/.well-known/assetlinks.json', (c) => {
    if (config.androidFingerprints.length === 0) return c.notFound();
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: config.androidPackage,
          sha256_cert_fingerprints: config.androidFingerprints,
        },
      },
    ]);
  });

  // The same, for iOS, once there is an iOS app.
  const appleSiteAssociation = (c: Context) => {
    if (config.iosAppIds.length === 0) return c.notFound();
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      applinks: {
        details: [
          {
            appIDs: config.iosAppIds,
            components: [
              { '/': '/post/*' },
              { '/': '/comment/*' },
              { '/': '/u/*' },
              { '/': '/c/*' },
              { '/': '/@*' },
            ],
          },
        ],
      },
    });
  };
  app.get('/.well-known/apple-app-site-association', appleSiteAssociation);
  app.get('/apple-app-site-association', appleSiteAssociation);

  app.get('/static/:file', (c) => {
    const asset = assets.get(c.req.param('file'));
    if (!asset) return c.notFound();
    c.header('Content-Type', asset.type);
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(asset.body as Uint8Array<ArrayBuffer>);
  });

  app.get('/', async (c) => {
    c.header('Vary', 'User-Agent');
    c.header('Cache-Control', 'public, max-age=300');
    return c.html(await homePage(config, openIn(config, '/', isAndroid(c))));
  });

  app.get('/post/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return missing(c, 'post');
    const open = openIn(config, `/post/${id}`, isAndroid(c));
    return page(c, 'post', await api.post(id), (post) => postPage(config, post, open));
  });

  app.get('/comment/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return missing(c, 'comment');
    const open = openIn(config, `/comment/${id}`, isAndroid(c));
    return page(c, 'comment', await api.comment(id), (comment) =>
      commentPage(config, comment, open),
    );
  });

  app.get('/u/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return missing(c, 'profile');
    const lookup = await api.profile(id);
    // One address per person: an account with a handle is at /@handle.
    if (lookup.kind === 'found' && lookup.value.username) {
      return c.redirect(`/@${lookup.value.username}`, 301);
    }
    const open = openIn(config, `/u/${id}`, isAndroid(c));
    return page(c, 'profile', lookup, (p) => profilePage(config, p, open));
  });

  app.get('/c/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (!NAME.test(slug)) return missing(c, 'community');
    const lookup = await api.community(slug);
    // Before /comment/, the app shared comments as /c/<id> -- the same path
    // as communities. Those links are out there; a community is never named
    // with an id, so an id that is not one is tried as a comment.
    if (lookup.kind === 'missing' && UUID.test(slug)) {
      const comment = await api.comment(slug);
      if (comment.kind === 'found') return c.redirect(`/comment/${slug}`, 301);
    }
    const open = openIn(config, `/c/${slug}`, isAndroid(c));
    return page(c, 'community', lookup, (community) =>
      communityPage(config, community, open),
    );
  });

  // /@handle. A route of its own can't start with a literal @ in every
  // router, so it is the one-segment catch-all, checked here.
  app.get('/:segment', async (c) => {
    const segment = c.req.param('segment');
    if (!segment.startsWith('@')) return missing(c, 'page');
    const handle = segment.slice(1);
    if (!NAME.test(handle)) return missing(c, 'profile');
    const open = openIn(config, `/@${handle}`, isAndroid(c));
    return page(c, 'profile', await api.profile(handle), (p) =>
      profilePage(config, p, open),
    );
  });

  app.notFound((c) => missing(c, 'page'));

  app.onError((error, c) => {
    console.error(`Failed ${c.req.method} ${c.req.path}:`, error);
    c.header('Cache-Control', 'no-store');
    return c.text('Something went wrong.', 500);
  });

  return app;
}

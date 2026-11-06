import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type {
  PublicAuthor,
  PublicCommunity,
  PublicMedia,
  PublicPost,
  PublicProfile,
} from './api.js';
import type { Config } from './config.js';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/**
 * The pages, as strings. Everything that came from the API goes through
 * `html`, which escapes it: a post is text somebody typed, and it is shown to
 * people who never chose to trust them. Nothing is ever passed through `raw`
 * except markup written here.
 *
 * There is no JavaScript on any page, and the Content-Security-Policy says
 * so (src/app.ts). A page that runs no script cannot be made to run anybody
 * else's.
 */

/** Only https addresses go into a src or an href; anything else is dropped. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Whitespace folded and cut at a word, for a card's one or two lines. */
export function summary(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function count(n: number, one: string, many: string): string {
  return `${compactNumber.format(n)} ${n === 1 ? one : many}`;
}

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function displayName(author: PublicAuthor): string {
  return author.name?.trim() || (author.username ? `@${author.username}` : 'Someone');
}

/** How a person on Android gets from this page into the app. */
export interface OpenIn {
  /** An intent: URL on Android, which opens the app or falls back to Play. */
  app: string | null;
  store: string;
}

export function openIn(config: Config, path: string, android: boolean): OpenIn {
  const host = new URL(config.siteUrl).host;
  return {
    app: android
      ? `intent://${host}${path}#Intent;scheme=https;package=${config.androidPackage};` +
        `S.browser_fallback_url=${encodeURIComponent(config.playUrl)};end`
      : null,
    store: config.playUrl,
  };
}

interface Meta {
  title: string;
  description: string;
  path: string;
  image: string | null;
  largeImage: boolean;
  /** og:type: article for a post, profile for a person, website otherwise. */
  type: 'article' | 'profile' | 'website';
  /** Kept out of search results: a page for something that is not there. */
  noindex?: boolean;
}

function layout(config: Config, meta: Meta, body: Html): Html {
  const canonical = `${config.siteUrl}${meta.path}`;
  const image = meta.image ?? `${config.siteUrl}/static/card.png`;
  const host = new URL(config.siteUrl).host;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${meta.title}</title>
<meta name="description" content="${meta.description}">
<link rel="canonical" href="${canonical}">
${meta.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:site_name" content="Kyron">
<meta property="og:type" content="${meta.type}">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="${meta.largeImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${meta.title}">
<meta name="twitter:description" content="${meta.description}">
<meta name="twitter:image" content="${image}">
<meta property="al:android:package" content="${config.androidPackage}">
<meta property="al:android:url" content="${canonical}">
<meta property="al:android:app_name" content="Kyron">
<meta name="theme-color" content="#0d0d0f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<link rel="icon" href="/static/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/site.css">
</head>
<body>
<header class="bar">
  <a class="brand" href="/"><img src="/static/logo.svg" width="28" height="28" alt=""><span>Kyron</span></a>
  <a class="bar-get" href="${config.playUrl}">Get the app</a>
</header>
<main>
${body}
</main>
<footer class="foot">
  <span>${host}</span>
  <a href="${config.termsUrl}">Terms</a>
  <a href="${config.privacyUrl}">Privacy</a>
</footer>
</body>
</html>`;
}

function openBlock(open: OpenIn, what: string): Html {
  if (open.app) {
    return html`<div class="open">
  <a class="button primary" href="${open.app}">Open in Kyron</a>
  <a class="button" href="${open.store}">Get Kyron on Google Play</a>
</div>`;
  }
  return html`<div class="open">
  <a class="button primary" href="${open.store}">Get Kyron on Google Play</a>
  <p class="hint">Kyron is an app. Open this link on your Android phone to see the ${what} there.</p>
</div>`;
}

function avatar(url: string | null, label: string, size: number, cls = 'avatar'): Html {
  const src = safeUrl(url);
  if (src) {
    return html`<img class="${cls}" src="${src}" width="${size}" height="${size}" alt="" loading="lazy">`;
  }
  const initial = Array.from(label.replace(/^@/, '').trim())[0]?.toUpperCase() ?? '?';
  return html`<span class="${cls} initial s${size}" aria-hidden="true">${initial}</span>`;
}

const tick = raw(
  '<svg class="tick" viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="Verified"><path fill="currentColor" d="M12 1.5l2.6 2 3.2-.3 1 3.1 2.8 1.6-.9 3.1 1.6 2.8-2.4 2.2-.3 3.2-3.2.4-2 2.6-2.9-1.4-2.9 1.4-2-2.6-3.2-.4-.3-3.2L1.6 14l1.6-2.8-.9-3.1 2.8-1.6 1-3.1 3.2.3z"/><path fill="#fff" d="M10.6 15.6l-3.3-3.3 1.4-1.4 1.9 1.9 4.7-4.7 1.4 1.4z"/></svg>',
);

function byline(author: PublicAuthor): Html {
  const name = displayName(author);
  const href = author.username ? `/@${author.username}` : null;
  const inner = html`${avatar(author.avatarUrl, name, 44)}
    <span class="who">
      <span class="name">${name}${author.verified ? tick : ''}</span>
      ${author.username ? html`<span class="handle">@${author.username}</span>` : ''}
    </span>`;
  return href
    ? html`<a class="byline" href="${href}">${inner}</a>`
    : html`<div class="byline">${inner}</div>`;
}

function mediaItem(m: PublicMedia): Html {
  const url = safeUrl(m.url);
  if (!url) return html``;
  // Width and height as attributes, not a style: the browser takes the
  // shape from them before the picture arrives, and the page's CSP allows no
  // inline style.
  const size =
    m.width && m.height
      ? html` width="${Math.round(m.width)}" height="${Math.round(m.height)}"`
      : '';
  if (m.kind === 'VIDEO') {
    const poster = safeUrl(m.thumbnailUrl);
    return html`<video class="media" controls preload="none" playsinline${size}${poster ? html` poster="${poster}"` : ''} src="${url}"></video>`;
  }
  return html`<img class="media" src="${url}" alt="${m.alt ?? ''}" loading="lazy"${size}>`;
}

/** The picture a card is drawn with: the post's own, else its author's face. */
export function cardImage(post: PublicPost): { url: string | null; large: boolean } {
  for (const m of post.media) {
    const url = m.kind === 'VIDEO' ? safeUrl(m.thumbnailUrl) : safeUrl(m.url);
    if (url) return { url, large: true };
  }
  return { url: safeUrl(post.author.avatarUrl), large: false };
}

export function postPage(config: Config, post: PublicPost, open: OpenIn): Html {
  const name = displayName(post.author);
  const handle = post.author.username ? ` (@${post.author.username})` : '';
  const text = summary(post.content);
  const image = cardImage(post);
  const media = post.media.filter((m) => safeUrl(m.url));
  const when = day.format(new Date(post.createdAt));

  return layout(
    config,
    {
      title: `${name}${handle} on Kyron`,
      description: text || (media.length ? 'A photo on Kyron' : 'A post on Kyron'),
      path: `/post/${post.id}`,
      image: image.url,
      largeImage: image.large,
      type: 'article',
    },
    html`<article class="card">
  ${byline(post.author)}
  ${post.community ? html`<a class="chip" href="/c/${post.community.slug}">${post.community.name}</a>` : ''}
  ${post.content.trim() ? html`<p class="content">${post.content.trim()}</p>` : ''}
  ${media.length ? html`<div class="gallery n${Math.min(media.length, 4)}">${media.map(mediaItem)}</div>` : ''}
  ${post.hasVoice ? html`<p class="voice">This post has a voice note. Open it in the app to listen.</p>` : ''}
  <p class="meta"><time datetime="${post.createdAt}">${when}</time>
    <span>${count(post.stats.likes, 'like', 'likes')}</span>
    <span>${count(post.stats.comments, 'comment', 'comments')}</span></p>
</article>
${openBlock(open, 'post and its replies')}`,
  );
}

export function profilePage(config: Config, profile: PublicProfile, open: OpenIn): Html {
  const name = displayName(profile);
  const handle = profile.username ? ` (@${profile.username})` : '';
  const cover = safeUrl(profile.coverUrl);
  const path = profile.username ? `/@${profile.username}` : `/u/${profile.id}`;
  return layout(
    config,
    {
      title: `${name}${handle} on Kyron`,
      description: profile.bio
        ? summary(profile.bio)
        : `${count(profile.stats.followers, 'follower', 'followers')} on Kyron`,
      path,
      image: safeUrl(profile.avatarUrl),
      largeImage: false,
      type: 'profile',
    },
    html`<section class="card profile">
  ${cover ? html`<img class="cover" src="${cover}" alt="" loading="lazy">` : html`<div class="cover blank"></div>`}
  ${avatar(profile.avatarUrl, name, 88, 'avatar big')}
  <h1 class="name">${name}${profile.verified ? tick : ''}</h1>
  ${profile.username ? html`<p class="handle">@${profile.username}</p>` : ''}
  ${profile.bio ? html`<p class="content">${profile.bio}</p>` : ''}
  <p class="meta">
    <span><strong>${compactNumber.format(profile.stats.posts)}</strong> ${profile.stats.posts === 1 ? 'post' : 'posts'}</span>
    <span><strong>${compactNumber.format(profile.stats.followers)}</strong> ${profile.stats.followers === 1 ? 'follower' : 'followers'}</span>
    <span><strong>${compactNumber.format(profile.stats.following)}</strong> following</span>
  </p>
</section>
${openBlock(open, 'profile and its posts')}`,
  );
}

export function communityPage(config: Config, community: PublicCommunity, open: OpenIn): Html {
  const banner = safeUrl(community.bannerUrl);
  return layout(
    config,
    {
      title: `${community.name} on Kyron`,
      description: community.description
        ? summary(community.description)
        : `A community of ${count(community.members, 'member', 'members')} on Kyron`,
      path: `/c/${community.slug}`,
      image: safeUrl(community.avatarUrl) ?? banner,
      largeImage: false,
      type: 'website',
    },
    html`<section class="card profile">
  ${banner ? html`<img class="cover" src="${banner}" alt="" loading="lazy">` : html`<div class="cover blank"></div>`}
  ${avatar(community.avatarUrl, community.name, 88, 'avatar big square')}
  <h1 class="name">${community.name}</h1>
  <p class="handle">${count(community.members, 'member', 'members')}</p>
  ${community.description ? html`<p class="content">${community.description}</p>` : ''}
</section>
${openBlock(open, 'community')}`,
  );
}

export function homePage(config: Config, open: OpenIn): Html {
  return layout(
    config,
    {
      title: 'Kyron',
      description: 'Kyron is a social app for sharing what you make, see and think.',
      path: '/',
      image: null,
      largeImage: true,
      type: 'website',
    },
    html`<section class="hero">
  <img src="/static/logo.svg" width="96" height="96" alt="">
  <h1>Kyron</h1>
  <p>Share what you make, see and think, with the people who care about it.</p>
</section>
${openBlock(open, 'feed')}`,
  );
}

export function missingPage(config: Config, path: string, what: string): Html {
  return layout(
    config,
    {
      title: 'Not found · Kyron',
      description: `This ${what} isn't on Kyron, or is no longer there.`,
      path,
      image: null,
      largeImage: false,
      type: 'website',
      noindex: true,
    },
    html`<section class="notice">
  <h1>Nothing here</h1>
  <p>This ${what} isn't on Kyron, or is no longer there. It may have been deleted, or the link may be mistyped.</p>
  <a class="button" href="/">Go to Kyron</a>
</section>`,
  );
}

export function downPage(config: Config, path: string): Html {
  return layout(
    config,
    {
      title: 'Kyron',
      description: 'Kyron could not be reached just now.',
      path,
      image: null,
      largeImage: false,
      type: 'website',
      noindex: true,
    },
    html`<section class="notice">
  <h1>Kyron can't be reached right now</h1>
  <p>This isn't your connection. Try again in a minute.</p>
</section>`,
  );
}

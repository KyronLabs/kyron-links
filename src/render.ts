import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type {
  PublicAuthor,
  PublicComment,
  PublicCommunity,
  PublicMedia,
  PublicPoll,
  PublicPost,
  PublicPostSummary,
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
 * else's. Nor is there an inline style: sizes come from attributes, and a
 * poll's bars are <progress> elements.
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

const dayAndTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

export function displayName(author: PublicAuthor): string {
  return (
    author.name?.trim() || (author.username ? `@${author.username}` : 'Someone')
  );
}

function titleFor(author: PublicAuthor): string {
  const handle = author.username ? ` (@${author.username})` : '';
  return `${displayName(author)}${handle} on Kyron`;
}

// ---------------------------------------------------------------- text --

/**
 * An address as a line of text shows it: no scheme, no www, and cut short.
 * The app does the same (display_url.dart): a link a screen wide is noise.
 */
export function displayUrl(url: string, max = 32): string {
  const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}

const TOKEN = /https?:\/\/[^\s<>"'`]+|@[A-Za-z0-9_.]{1,64}/g;

/**
 * A post's text, with its addresses and mentions made into links.
 *
 * Built from escaped pieces: the text between links goes through `html`
 * like everything else, and each link's address and words do too. An
 * address is only linked if it is http or https; a mention only if it
 * starts a word, so ada@example.com stays an email address and is not a
 * link to @example.com.
 */
export function richText(text: string): Html {
  const parts: Html[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    let token = match[0];
    if (token.startsWith('@')) {
      const before = start > 0 ? text[start - 1] ?? '' : '';
      if (/[A-Za-z0-9_.]/.test(before)) continue;
      // A trailing dot is the end of the sentence, not the handle.
      token = token.replace(/\.+$/, '');
      if (token.length < 2) continue;
      parts.push(html`${text.slice(at, start)}`);
      parts.push(html`<a class="mention" href="/${token}">${token}</a>`);
    } else {
      // Punctuation after an address usually belongs to the sentence.
      token = token.replace(/[.,;:!?)\]}]+$/, '');
      const href = /^https?:\/\//i.test(token) ? token : null;
      if (!href) continue;
      parts.push(html`${text.slice(at, start)}`);
      parts.push(
        html`<a class="link" href="${href}" rel="nofollow ugc noopener noreferrer">${displayUrl(href)}</a>`,
      );
    }
    at = start + token.length;
  }
  parts.push(html`${text.slice(at)}`);
  return html`${parts}`;
}

// ------------------------------------------------------------ the app --

/** How a person gets from this page into the app. */
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

// -------------------------------------------------------------- layout --

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
  const report =
    `mailto:${config.reportEmail}` +
    `?subject=${encodeURIComponent(`Report: ${canonical}`)}` +
    `&body=${encodeURIComponent(`What is wrong with ${canonical}?\n\n`)}`;
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
  ${meta.noindex ? '' : html`<a href="${report}">Report</a>`}
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------- components --

function avatar(url: string | null, label: string, size: 24 | 44 | 88, cls = 'avatar'): Html {
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

/** One line: small face, name, handle, date. For quotes and list items. */
function miniByline(author: PublicAuthor, createdAt: string): Html {
  const name = displayName(author);
  return html`<span class="mini">${avatar(author.avatarUrl, name, 24)}<span class="name">${name}${author.verified ? tick : ''}</span>${author.username ? html`<span class="handle">@${author.username}</span>` : ''}<span class="handle">· ${day.format(new Date(createdAt))}</span></span>`;
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

/**
 * Up to four tiles. When a post has more than it shows, the last tile says
 * how many more: eight pictures shown as four, with nothing said, reads as
 * four.
 */
function gallery(media: PublicMedia[], total: number): Html {
  const shown = media.filter((m) => safeUrl(m.url)).slice(0, 4);
  if (shown.length === 0) return html``;
  const more = Math.max(0, total - shown.length);
  return html`<div class="gallery n${shown.length}">${shown.map((m, i) =>
    i === shown.length - 1 && more > 0
      ? html`<div class="tile more">${mediaItem(m)}<span class="more-count" aria-label="${more} more in the app">+${more}</span></div>`
      : html`<div class="tile">${mediaItem(m)}</div>`,
  )}</div>`;
}

/** The first picture, small, for a quote or a list item. */
function thumb(media: PublicMedia[], total: number): Html {
  const first = media[0];
  if (!first) return html``;
  const src = first.kind === 'VIDEO' ? safeUrl(first.thumbnailUrl) : safeUrl(first.url);
  if (!src) return html``;
  const more = total > 1 ? html`<span class="thumb-count">+${total - 1}</span>` : '';
  return html`<span class="thumb"><img src="${src}" alt="" loading="lazy" width="72" height="72">${more}</span>`;
}

export function pollBlock(poll: PublicPoll, now = new Date()): Html {
  const closed = new Date(poll.closesAt) <= now;
  const total = poll.totalVotes;
  const lead = Math.max(0, ...poll.options.map((o) => o.votes));
  return html`<div class="poll">
  ${poll.options.map((o) => {
    const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
    const top = closed && total > 0 && o.votes === lead;
    return html`<div class="option${top ? ' top' : ''}">
    <div class="option-row"><span class="option-text">${o.text}</span><span class="option-pct">${pct}%</span></div>
    <progress max="${Math.max(total, 1)}" value="${o.votes}">${pct}%</progress>
  </div>`;
  })}
  <p class="poll-meta">${count(total, 'vote', 'votes')} · ${closed ? 'Final results' : html`Open until ${dayAndTime.format(new Date(poll.closesAt))}`}</p>
</div>`;
}

function quoteCard(quoted: NonNullable<PublicPost['quoted']>): Html {
  return html`<a class="quote" href="/post/${quoted.id}">
  ${miniByline(quoted.author, quoted.createdAt)}
  <span class="quote-body"><span class="quote-text">${summary(quoted.content, 280)}</span>${thumb(quoted.media, quoted.media.length)}</span>
</a>`;
}

/** A post in a list: the whole card is one link to its page. */
function listItem(post: PublicPostSummary): Html {
  return html`<a class="item" href="/post/${post.id}">
  ${miniByline(post.author, post.createdAt)}
  <span class="item-body">
    ${post.content.trim() ? html`<span class="item-text">${summary(post.content, 280)}</span>` : html`<span class="item-text muted">${post.hasVoice ? 'A voice note' : 'A photo'}</span>`}
    ${thumb(post.media, post.mediaCount)}
  </span>
  <span class="meta"><span>${count(post.stats.likes, 'like', 'likes')}</span><span>${count(post.stats.comments, 'comment', 'comments')}</span></span>
</a>`;
}

function recentList(posts: PublicPostSummary[], empty: string): Html {
  return html`<section class="recent">
  <h2>Recent posts</h2>
  ${posts.length ? html`<div class="list">${posts.map(listItem)}</div>` : html`<p class="hint">${empty}</p>`}
</section>`;
}

/** The picture a card is drawn with: the post's own, else its author's face. */
export function cardImage(
  post: Pick<PublicPostSummary, 'media' | 'author'>,
): { url: string | null; large: boolean } {
  for (const m of post.media) {
    const url = m.kind === 'VIDEO' ? safeUrl(m.thumbnailUrl) : safeUrl(m.url);
    if (url) return { url, large: true };
  }
  return { url: safeUrl(post.author.avatarUrl), large: false };
}

// --------------------------------------------------------------- pages --

export function postPage(config: Config, post: PublicPost, open: OpenIn, now = new Date()): Html {
  const image = cardImage(post);
  const text = summary(post.content);
  const description =
    text ||
    (post.poll
      ? 'A poll on Kyron'
      : post.mediaCount > 1
        ? `${post.mediaCount} photos on Kyron`
        : post.mediaCount === 1
          ? 'A photo on Kyron'
          : 'A post on Kyron');

  return layout(
    config,
    {
      title: titleFor(post.author),
      description,
      path: `/post/${post.id}`,
      image: image.url,
      largeImage: image.large,
      type: 'article',
    },
    html`<article class="card">
  ${byline(post.author)}
  ${post.community ? html`<a class="chip" href="/c/${post.community.slug}">${post.community.name}</a>` : ''}
  ${post.content.trim() ? html`<p class="content">${richText(post.content.trim())}</p>` : ''}
  ${post.poll ? pollBlock(post.poll, now) : ''}
  ${gallery(post.media, post.mediaCount)}
  ${post.hasVoice ? html`<p class="voice">This post has a voice note. Open it in the app to listen.</p>` : ''}
  ${post.quoted ? quoteCard(post.quoted) : ''}
  <p class="meta"><time datetime="${post.createdAt}">${day.format(new Date(post.createdAt))}</time>
    <span>${count(post.stats.likes, 'like', 'likes')}</span>
    <span>${count(post.stats.comments, 'comment', 'comments')}</span>
    ${post.stats.reposts > 0 ? html`<span>${count(post.stats.reposts, 'repost', 'reposts')}</span>` : ''}</p>
</article>
${openBlock(open, post.poll ? 'poll and vote' : 'post and its replies')}`,
  );
}

export function commentPage(config: Config, comment: PublicComment, open: OpenIn): Html {
  const own = cardImage({ media: comment.media, author: comment.author });
  const image = comment.media.length ? own : cardImage(comment.post);
  const replyTo = displayName(comment.post.author);
  return layout(
    config,
    {
      title: titleFor(comment.author),
      description:
        summary(comment.content) || `A reply to ${replyTo} on Kyron`,
      path: `/comment/${comment.id}`,
      image: image.url ?? safeUrl(comment.author.avatarUrl),
      largeImage: image.large,
      type: 'article',
    },
    html`<article class="card">
  ${byline(comment.author)}
  <p class="replying">Replying to ${comment.post.author.username ? html`<a href="/@${comment.post.author.username}">@${comment.post.author.username}</a>` : replyTo}</p>
  ${comment.content.trim() ? html`<p class="content">${richText(comment.content.trim())}</p>` : ''}
  ${gallery(comment.media, comment.media.length)}
  <p class="meta"><time datetime="${comment.createdAt}">${day.format(new Date(comment.createdAt))}</time>
    <span>${count(comment.stats.likes, 'like', 'likes')}</span>
    <span>${count(comment.stats.replies, 'reply', 'replies')}</span></p>
</article>
<section class="recent">
  <h2>The post</h2>
  <div class="list">${listItem(comment.post)}</div>
</section>
${openBlock(open, 'whole conversation')}`,
  );
}

export function profilePage(config: Config, profile: PublicProfile, open: OpenIn): Html {
  const name = displayName(profile);
  const cover = safeUrl(profile.coverUrl);
  const path = profile.username ? `/@${profile.username}` : `/u/${profile.id}`;
  return layout(
    config,
    {
      title: titleFor(profile),
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
  ${profile.bio ? html`<p class="content">${richText(profile.bio)}</p>` : ''}
  <p class="meta">
    <span><strong>${compactNumber.format(profile.stats.posts)}</strong> ${profile.stats.posts === 1 ? 'post' : 'posts'}</span>
    <span><strong>${compactNumber.format(profile.stats.followers)}</strong> ${profile.stats.followers === 1 ? 'follower' : 'followers'}</span>
    <span><strong>${compactNumber.format(profile.stats.following)}</strong> following</span>
  </p>
</section>
${openBlock(open, 'profile and follow it')}
${recentList(profile.recent, 'No posts yet.')}`,
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
  ${community.description ? html`<p class="content">${richText(community.description)}</p>` : ''}
</section>
${openBlock(open, 'community and join it')}
${recentList(community.recent, 'Nothing has been posted here yet.')}`,
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

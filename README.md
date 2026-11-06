# kyron-links

The pages a Kyron link opens for someone who doesn't have the app.

A post, profile or community shared from Kyron is a link. When the person
receiving it has the app, Android opens the link in the app. When they don't,
or when a chat app draws a preview card, the link lands here. Each page is
read-only:

- the post, profile or community, as it looks to anybody signed out;
- the card WhatsApp, X, iMessage, Slack and Discord draw from it;
- a way into the app: **Open in Kyron** on Android, otherwise the store.

You can't sign in, post, like, follow or message here. That's the point: this
is Telegram's `t.me` layer, not a web client.

## Routes

| Path | Shows |
|:--|:--|
| `/` | What Kyron is, and where to get it |
| `/post/:id` | A post, with its poll, the post it quotes, and "+4" when it has more pictures than it shows |
| `/comment/:id` | A comment, with the post it answers |
| `/@:handle` | A profile and its latest posts |
| `/u/:id` | A profile by id. Redirects to `/@handle` when there is one. |
| `/c/:slug` | A community and its latest posts. An id that isn't a community but is a comment redirects to `/comment/:id`, for links the app shared before comments had their own path. |
| `/.well-known/assetlinks.json` | Android App Links. Served only once `ANDROID_CERT_SHA256` is set. |
| `/.well-known/apple-app-site-association` | iOS Universal Links. Served only once `IOS_APP_IDS` is set. |
| `/healthz` | `ok` |

Everything is read from the API's `/public/*` routes (KyronLabs/kyron,
`api/src/modules/public`), which decide field by field what a stranger may
see. This service never touches the database.

## Security

The pages are a small target on purpose:

- **No JavaScript.** Not one script tag. The Content-Security-Policy has
  `default-src 'none'` and no `script-src`, so injected markup has nothing to
  run with.
- **Everything is escaped.** Text from the API goes through Hono's `html`
  tag. Tests feed it `<script>` in a post and in a display name.
- **Only https addresses** reach a `src` or `href`. A `javascript:` or `data:`
  URL is dropped (`safeUrl`).
- **Read-only.** Anything but GET and HEAD gets 405. No forms, no cookies, no
  sessions.
- **Cannot be framed.** `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **Bad input never reaches the API.** Post ids must be UUIDs, handles and
  slugs must match `[A-Za-z0-9_.-]{1,64}`, and anything else is a 404.
- **A minute's memory.** Each answer, including "not found", is cached for 60
  seconds. A card drawn by twenty phones at once is one request, and guessing
  ids doesn't become one API call per guess.
- **A ceiling on the API.** At most 30 API requests a second, whoever is asking,
  so someone requesting made-up ids can't spend the API's bucket for this
  service, and everyone else's with it. It is counted for the whole service, not
  per visitor, because behind Render's proxies a visitor's real address can't be
  trusted.
- **A day's memory when the API is down.** A link that worked earlier still
  shows what it showed then. "Not found" is never kept that long, so a deleted
  post can't come back.
- **Links people wrote** become links only if they are http or https, and carry
  `rel="nofollow ugc noopener noreferrer"`. @mentions link to `/@handle`.
- **Report**, in every page's footer, writes to `REPORT_EMAIL`, so anybody who
  finds something on a public page has a way to get it taken down.

The API is the real boundary. This service only shows what `/public/*` returns.

## Configuration

| Variable | Default | |
|:--|:--|:--|
| `API_URL` | `https://kyron-47r6.onrender.com` | The API |
| `SITE_URL` | `https://kyron-links.onrender.com` | The address links are written with: canonical URLs, cards, the Android intent |
| `PUBLIC_PAGES_KEY` | none | The same value as the API's. Without it, every visitor shares the API's per-address limit of 100 requests a minute. |
| `ANDROID_CERT_SHA256` | none | The app signing certificate's SHA-256, from Play Console → App integrity → App signing. Several, comma-separated. |
| `ANDROID_PACKAGE` | `so.kyron.app` | |
| `IOS_APP_IDS` | none | `TEAMID.bundle.id`, once there is an iOS app |
| `PLAY_URL`, `APP_STORE_URL` | Play listing, none | |
| `TERMS_URL`, `PRIVACY_URL` | the published pages | |
| `REPORT_EMAIL` | `spidroidtechnologiesinc@gmail.com` | Where Report writes to |
| `PORT` | `3000` | |

The server refuses to start on a value that is wrong, such as a malformed
fingerprint, an `http://` address or a key too short for the API to accept,
rather than serving with it.

## Running it

```sh
npm ci
npm test
npm run build && npm start
```

## Deploying on Render, without a card

Render asks for a card for Blueprints (`render.yaml`), but not for a single
web service on the Free plan. To set one up by hand:

1. Dashboard → **New** → **Web Service** → this repository.
2. **Language** Node, **Branch** `main`, **Region** Oregon (the API's).
3. **Build command** `npm ci && npm run build`
4. **Start command** `npm start`
5. **Instance type** Free.
6. **Environment**: `NODE_VERSION` = `22`, and the variables below as you get
   them. Every one has a working default except the key and the fingerprint.
7. **Advanced** → **Health check path** `/healthz`.

The service comes up at `https://kyron-links.onrender.com`, or a name like it if
that one is taken. Set `SITE_URL` to whatever address it gets.

### What Free costs you

A free service **sleeps after 15 minutes without a visit**, and the next visit
waits about a minute while it wakes. A person waits that out. WhatsApp, X and
iMessage don't: they give up after a few seconds and post the link without a
card. Two ways round it:

- **Keep it awake.** A free pinger such as cron-job.org or UptimeRobot can open
  `https://<site>/healthz` every 10 minutes. Free services share 750 hours a
  month per workspace, and one awake all month uses about 744, so this works
  for one service, not two. If the API is also on Free and asleep, kyron-links
  waits for it too (up to 10 seconds).
- **Starter** ($7 a month) never sleeps. That's the fix once links matter.

The day-long memory helps only while kyron-links itself is awake: it lives in
the server's process, so a sleeping service has forgotten everything when it
wakes.

## Deploying

Once it's up:

1. Set `PUBLIC_PAGES_KEY` here and on the API to the same value
   (`openssl rand -hex 32`).
2. Set `ANDROID_CERT_SHA256` (Play Console → Test and release → App integrity →
   App signing → *App signing key certificate*, SHA-256). Check that
   `https://<site>/.well-known/assetlinks.json` answers.
3. When there's a domain, attach it, then set `SITE_URL` to it.

The app's links (`KyronLinks.host` in KyronLabs/kyron) must use the same
domain. Android verifies App Links per host, so links on a domain that serves
no `assetlinks.json` open in the browser, never in the app.

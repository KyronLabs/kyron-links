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
| `/post/:id` | A post |
| `/@:handle` | A profile |
| `/u/:id` | A profile by id. Redirects to `/@handle` when there is one. |
| `/c/:slug` | A community |
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

## Deploying

`render.yaml` describes the service. Once it's up:

1. Set `PUBLIC_PAGES_KEY` here and on the API to the same value
   (`openssl rand -hex 32`).
2. Set `ANDROID_CERT_SHA256`. Check that
   `https://<site>/.well-known/assetlinks.json` answers.
3. Attach the domain, then set `SITE_URL` to it.

The app's links (`KyronLinks.host` in KyronLabs/kyron) must use the same
domain. Android verifies App Links per host, so links on a domain that serves
no `assetlinks.json` open in the browser, never in the app.

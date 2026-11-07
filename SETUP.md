# Setting up kyron-links

How to deploy kyron-links on Render, configure it, and connect it to the app.
For what the service is and how it works, see [README.md](README.md).

## 1. Create the service

Deploy it as a Blueprint, from `render.yaml`:

1. Dashboard → **New** → **Blueprint** → `KyronLabs/kyron-links`.
2. Render reads `render.yaml` and creates the `kyron-links` web service: Node,
   Oregon (the API's region), Free plan, the build and start commands, the
   health check, and every variable with a value.
3. It asks for the two variables marked `sync: false`, `PUBLIC_PAGES_KEY` and
   `ANDROID_CERT_SHA256`. Fill them in now or later (step 2).

From then on, `render.yaml` is the service's settings. Change them there, in a
pull request, and Render applies the change when it merges. A setting changed
only in the dashboard is overwritten the next time the Blueprint syncs.

The service comes up at `https://kyron-links.onrender.com`, or a similar name
if that one is taken. If the name differs, change `SITE_URL` in `render.yaml`.

### Without a Blueprint

Render may ask for a card before deploying a Blueprint. A single web service
on the Free plan doesn't need one. To create it by hand instead:

1. Dashboard → **New** → **Web Service** → `KyronLabs/kyron-links`.
2. **Language** Node, **Branch** `main`, **Region** Oregon.
3. **Build command:** `npm ci && npm run build`
4. **Start command:** `npm start`
5. **Instance type:** Free.
6. **Environment:** `NODE_VERSION` = `22`, and the variables in step 2.
7. **Advanced** → **Health check path:** `/healthz`

A service made this way doesn't read `render.yaml`: its settings live only in
the dashboard. Use one way or the other, never both, or there will be two
services answering for the same thing.

## 2. Set the variables

Every variable has a working default except `PUBLIC_PAGES_KEY` and
`ANDROID_CERT_SHA256`.

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

The server refuses to start on a wrong value, such as a malformed fingerprint,
an `http://` address or a key too short for the API to accept, rather than
running with it.

### `PUBLIC_PAGES_KEY`

Generate one with `openssl rand -hex 32`. Set the same value on this service
and on the API (`kyron`). Without it, every visitor to every shared link shares
the API's limit of 100 requests a minute for a single address.

### `ANDROID_CERT_SHA256`

In Play Console: **Test and release** → **App integrity** → **App signing** →
*App signing key certificate*, **SHA-256 certificate fingerprint**. Then check
that `https://<site>/.well-known/assetlinks.json` answers. Without it, shared
links open in the browser instead of the app.

## 3. Keep it awake

A free service **sleeps after 15 minutes without a visit**, and the next visit
waits about a minute while it wakes. A person waits that out. WhatsApp, X and
iMessage don't: they give up after a few seconds and post the link with no
preview card. Two ways round it:

- **A free pinger.** Have cron-job.org or UptimeRobot open
  `https://<site>/healthz` every 10 minutes. Free services share 750 hours a
  month per workspace, and one awake all month uses about 744, so this works
  for one service, not two. If the API is also on Free and asleep, kyron-links
  waits for it too, for up to 10 seconds.
- **Starter**, at $7 a month, never sleeps. That's the fix once links matter.

The day-long memory for when the API is down only helps while kyron-links is
awake. It lives in the server's process, so a service that has slept has
forgotten everything.

## 4. Attach a domain

When there's a domain:

1. Attach it to the service in Render.
2. Set `SITE_URL` to it.
3. Point the app's links (`KyronLinks.host` in KyronLabs/kyron) at the same
   domain.

Android checks App Links domain by domain, so links on a domain that doesn't
serve `assetlinks.json` open in the browser, never in the app.

## Checking it works

- `https://<site>/healthz` answers `ok`.
- `https://<site>/@kyron` shows the Kyron profile.
- `https://<site>/.well-known/assetlinks.json` answers once
  `ANDROID_CERT_SHA256` is set.
- Pasting a post link into WhatsApp draws a card. If it doesn't, the service
  was probably asleep: paste it again.

import { serve } from '@hono/node-server';

import { HttpApi } from './api.js';
import { createApp } from './app.js';
import { loadAssets } from './assets.js';
import { readConfig } from './config.js';

const config = readConfig();
const api = new HttpApi({ apiUrl: config.apiUrl, pagesKey: config.pagesKey });
const app = createApp(config, api, loadAssets());

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `kyron-links on :${info.port}, as ${config.siteUrl}, reading ${config.apiUrl}` +
      (config.pagesKey ? '' : ' (no PUBLIC_PAGES_KEY: sharing the per-address limit)') +
      (config.androidFingerprints.length
        ? ''
        : ' (no ANDROID_CERT_SHA256: links will not open the app on their own)'),
  );
});

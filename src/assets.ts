import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Asset } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The static files, read once: there are three, and none changes at runtime. */
export function loadAssets(dir = join(here, '..', 'static')): Map<string, Asset> {
  const types: Record<string, string> = {
    'logo.svg': 'image/svg+xml',
    'site.css': 'text/css; charset=utf-8',
    'card.png': 'image/png',
  };
  return new Map(
    Object.entries(types).map(([name, type]) => [
      name,
      { body: readFileSync(join(dir, name)), type },
    ]),
  );
}

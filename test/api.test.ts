import { describe, expect, it, vi } from 'vitest';

import { HttpApi, Memory, Throttle } from '../src/api.js';

function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function apiWith(
  fetch: ReturnType<typeof vi.fn>,
  now = () => 0,
  pagesKey = '',
  throttle = new Throttle(1000, now),
) {
  return new HttpApi({
    apiUrl: 'https://api.example',
    pagesKey,
    fetch: fetch as unknown as typeof globalThis.fetch,
    memory: new Memory(60_000, 3, now),
    throttle,
  });
}

describe('reading the API', () => {
  it('asks the public route, and identifies itself when it has a key', async () => {
    const fetch = vi.fn(async () => response(200, { id: 'p' }));
    const key = 'k'.repeat(64);
    await apiWith(fetch, () => 0, key).post('p1');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/public/posts/p1');
    expect((init.headers as Record<string, string>)['x-kyron-pages-key']).toBe(key);
    // A redirect would be the API, or something pretending to be it, sending
    // this server somewhere else.
    expect(init.redirect).toBe('error');
  });

  it('sends no key header at all when it has none', async () => {
    const fetch = vi.fn(async () => response(200, {}));
    await apiWith(fetch).post('p1');
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('x-kyron-pages-key');
  });

  it('remembers an answer for a minute, then asks again', async () => {
    let now = 0;
    const fetch = vi.fn(async () => response(200, { id: 'p' }));
    const api = apiWith(fetch, () => now);

    expect((await api.post('p1')).kind).toBe('found');
    await api.post('p1');
    expect(fetch).toHaveBeenCalledTimes(1);

    now = 60_001;
    await api.post('p1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('remembers "not found" too, so guessing ids does not reach the API', async () => {
    const fetch = vi.fn(async () => response(404));
    const api = apiWith(fetch);
    expect((await api.post('nope')).kind).toBe('missing');
    expect((await api.post('nope')).kind).toBe('missing');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not remember the API being down: that is not an answer', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, { id: 'p' }));
    const api = apiWith(fetch);
    expect((await api.post('p1')).kind).toBe('down');
    expect((await api.post('p1')).kind).toBe('down');
    expect((await api.post('p1')).kind).toBe('found');
  });

  it('asks once for twenty phones drawing the same card at once', async () => {
    let release!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (release = r)));
    const api = apiWith(fetch);
    const all = Promise.all(Array.from({ length: 20 }, () => api.post('p1')));
    release(response(200, { id: 'p' }));
    const results = await all;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.kind === 'found')).toBe(true);
  });

  it('keeps its memory to a fixed size, forgetting the oldest', () => {
    const memory = new Memory(60_000, 3, () => 0);
    for (const k of ['a', 'b', 'c', 'd']) memory.set(k, { kind: 'missing' });
    expect(memory.size).toBe(3);
    expect(memory.get('a')).toBeUndefined();
    expect(memory.get('d')).toEqual({ kind: 'missing' });
  });

  it('asks for handles and slugs in lower case, so Ada and ada are one entry', async () => {
    const fetch = vi.fn(async () => response(200, {}));
    const api = apiWith(fetch);
    await api.profile('Ada');
    await api.profile('ada');
    await api.community('Sailing');
    expect(fetch.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      'https://api.example/public/profiles/ada',
      'https://api.example/public/communities/sailing',
    ]);
  });

  it('asks for a comment at its own route', async () => {
    const fetch = vi.fn(async () => response(200, {}));
    await apiWith(fetch).comment('c1');
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example/public/comments/c1');
  });

  it('shows what it last found when the API is away, for a day', async () => {
    let now = 0;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { id: 'p', content: 'then' }))
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const api = apiWith(fetch, () => now);

    await api.post('p1');
    now = 60 * 60 * 1000; // an hour on: stale, and the API is down
    expect(await api.post('p1')).toEqual({ kind: 'found', value: { id: 'p', content: 'then' } });

    now = 25 * 60 * 60 * 1000; // past the day
    expect((await api.post('p1')).kind).toBe('down');
  });

  it('never brings back something that was not found', async () => {
    let now = 0;
    const fetch = vi.fn().mockResolvedValueOnce(response(404)).mockRejectedValue(new Error('down'));
    const api = apiWith(fetch, () => now);
    await api.post('gone');
    now = 2 * 60 * 1000;
    expect((await api.post('gone')).kind).toBe('down');
  });

  it('asks the API at most so often a second, whoever is asking', async () => {
    let now = 0;
    const fetch = vi.fn(async () => response(404));
    const api = apiWith(fetch, () => now, '', new Throttle(3, () => now));

    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => api.post(id)));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(results.map((r) => r.kind)).toEqual(['missing', 'missing', 'missing', 'down', 'down']);

    now = 1000;
    await api.post('f');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('when the API fails', () => {
  it('says why, briefly, and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: [ReturnType<typeof vi.fn>, string][] = [
      [vi.fn(async () => response(502)), 'status 502'],
      [vi.fn(async () => response(429)), 'status 429'],
      [
        vi.fn(async () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ECONNREFUSED' },
          });
        }),
        'TypeError ECONNREFUSED',
      ],
      [
        vi.fn(async () => {
          throw new DOMException('timed out', 'TimeoutError');
        }),
        'TimeoutError',
      ],
    ];
    for (const [fetch, reason] of cases) {
      expect(await apiWith(fetch).post('p1')).toEqual({ kind: 'down', reason });
    }
    expect(warn).toHaveBeenCalledWith('API /public/posts/p1 failed: status 502');
    warn.mockRestore();
  });

  it('says so when it is the ceiling, not the API', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = apiWith(vi.fn(async () => response(200)), () => 0, '', new Throttle(0, () => 0));
    expect(await api.post('p1')).toEqual({ kind: 'down', reason: 'throttled' });
    warn.mockRestore();
  });
});

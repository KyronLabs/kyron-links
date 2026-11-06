/**
 * Reading the API's public routes, with a short memory.
 *
 * Every page is one request to the API at most once a minute: a post shared
 * into a busy group chat is fetched by every phone that draws its card, and
 * all of them can have the same answer. "Not found" is remembered too, so
 * somebody asking for random ids does not turn into one API request per
 * guess -- they share the same bucket on the API as every real visitor.
 */

export interface PublicAuthor {
  name: string | null;
  username: string | null;
  verified: boolean;
  avatarUrl: string | null;
}

export interface PublicMedia {
  kind: 'IMAGE' | 'VIDEO' | 'GIF' | 'VOICE';
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
}

export interface PublicPost {
  id: string;
  content: string;
  createdAt: string;
  author: PublicAuthor;
  community: { name: string; slug: string } | null;
  media: PublicMedia[];
  hasVoice: boolean;
  stats: { likes: number; comments: number; reposts: number };
}

export interface PublicProfile extends PublicAuthor {
  id: string;
  bio: string | null;
  coverUrl: string | null;
  stats: { followers: number; following: number; posts: number };
}

export interface PublicCommunity {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  members: number;
}

/** What a lookup came to. `down` is the API failing, not the thing missing. */
export type Lookup<T> =
  | { kind: 'found'; value: T }
  | { kind: 'missing' }
  | { kind: 'down' };

export interface Api {
  post(id: string): Promise<Lookup<PublicPost>>;
  profile(handleOrId: string): Promise<Lookup<PublicProfile>>;
  community(slug: string): Promise<Lookup<PublicCommunity>>;
}

interface Entry {
  until: number;
  lookup: Lookup<unknown>;
}

/** A small cache that forgets the oldest first. */
export class Memory {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Lookup<unknown> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.lookup;
  }

  set(key: string, lookup: Lookup<unknown>): void {
    this.entries.delete(key);
    this.entries.set(key, { until: this.now() + this.ttlMs, lookup });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface HttpApiOptions {
  apiUrl: string;
  pagesKey: string;
  fetch?: typeof fetch;
  memory?: Memory;
  timeoutMs?: number;
}

export class HttpApi implements Api {
  private readonly fetch: typeof fetch;
  private readonly memory: Memory;
  private readonly timeoutMs: number;
  private readonly inFlight = new Map<string, Promise<Lookup<unknown>>>();

  constructor(private readonly options: HttpApiOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.memory = options.memory ?? new Memory(60_000, 5_000);
    this.timeoutMs = options.timeoutMs ?? 4_000;
  }

  post(id: string) {
    return this.read<PublicPost>(`/public/posts/${encodeURIComponent(id)}`);
  }

  profile(handleOrId: string) {
    return this.read<PublicProfile>(
      `/public/profiles/${encodeURIComponent(handleOrId.toLowerCase())}`,
    );
  }

  community(slug: string) {
    return this.read<PublicCommunity>(
      `/public/communities/${encodeURIComponent(slug.toLowerCase())}`,
    );
  }

  private async read<T>(path: string): Promise<Lookup<T>> {
    const remembered = this.memory.get(path);
    if (remembered) return remembered as Lookup<T>;

    // A card drawn by twenty phones at once is one request, not twenty.
    const pending = this.inFlight.get(path);
    if (pending) return (await pending) as Lookup<T>;

    const request = this.fetchOnce(path).finally(() =>
      this.inFlight.delete(path),
    );
    this.inFlight.set(path, request);
    return (await request) as Lookup<T>;
  }

  private async fetchOnce(path: string): Promise<Lookup<unknown>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.options.pagesKey) {
      headers['x-kyron-pages-key'] = this.options.pagesKey;
    }

    let response: Response;
    try {
      response = await this.fetch(`${this.options.apiUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch {
      // Not remembered: the API being briefly away is not an answer.
      return { kind: 'down' };
    }

    // 400 is the API refusing the name as one that could not exist: as
    // missing as a 404, from where the visitor stands.
    if (response.status === 404 || response.status === 400) {
      const lookup: Lookup<unknown> = { kind: 'missing' };
      this.memory.set(path, lookup);
      return lookup;
    }
    if (!response.ok) return { kind: 'down' };

    try {
      const lookup: Lookup<unknown> = {
        kind: 'found',
        value: (await response.json()) as unknown,
      };
      this.memory.set(path, lookup);
      return lookup;
    } catch {
      return { kind: 'down' };
    }
  }
}

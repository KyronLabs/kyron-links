/**
 * Reading the API's public routes, with a short memory.
 *
 * Every page is one request to the API at most once a minute: a post shared
 * into a busy group chat is fetched by every phone that draws its card, and
 * all of them can have the same answer. "Not found" is remembered too, so
 * somebody asking for random ids does not turn into one API request per
 * guess -- they share the same bucket on the API as every real visitor.
 *
 * What was found is also kept, past its minute, for a day: when the API is
 * down or asleep, a link that worked an hour ago still shows what it showed
 * then, rather than an error.
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

/** A post as a list shows it. */
export interface PublicPostSummary {
  id: string;
  content: string;
  createdAt: string;
  author: PublicAuthor;
  community: { name: string; slug: string } | null;
  /** The first four. */
  media: PublicMedia[];
  /** All of them, so a page showing four can say there are more. */
  mediaCount: number;
  hasVoice: boolean;
  stats: { likes: number; comments: number; reposts: number };
}

export interface PublicPoll {
  options: { text: string; votes: number }[];
  totalVotes: number;
  closesAt: string;
}

export interface PublicPost extends PublicPostSummary {
  poll: PublicPoll | null;
  quoted: {
    id: string;
    content: string;
    createdAt: string;
    author: PublicAuthor;
    media: PublicMedia[];
  } | null;
}

export interface PublicComment {
  id: string;
  content: string;
  createdAt: string;
  author: PublicAuthor;
  media: PublicMedia[];
  stats: { likes: number; replies: number };
  post: PublicPostSummary;
}

export interface PublicProfile extends PublicAuthor {
  id: string;
  bio: string | null;
  coverUrl: string | null;
  stats: { followers: number; following: number; posts: number };
  recent: PublicPostSummary[];
}

export interface PublicCommunity {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  members: number;
  recent: PublicPostSummary[];
}

/** What a lookup came to. `down` is the API failing, not the thing missing. */
export type Lookup<T> =
  | { kind: 'found'; value: T }
  | { kind: 'missing' }
  | { kind: 'down' };

export interface Api {
  post(id: string): Promise<Lookup<PublicPost>>;
  comment(id: string): Promise<Lookup<PublicComment>>;
  profile(handleOrId: string): Promise<Lookup<PublicProfile>>;
  community(slug: string): Promise<Lookup<PublicCommunity>>;
}

interface Entry {
  /** Fresh until: answered from memory without asking. */
  until: number;
  /** Kept until: shown when the API cannot be reached. */
  keepUntil: number;
  lookup: Lookup<unknown>;
}

/** A small cache that forgets the oldest first. */
export class Memory {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
    /** How long a found answer is kept for when the API is away. */
    private readonly keepMs = 24 * 60 * 60 * 1000,
  ) {}

  /** A fresh answer, or nothing. */
  get(key: string): Lookup<unknown> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.keepUntil <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.until > this.now() ? entry.lookup : undefined;
  }

  /**
   * The last thing found, however old, within the day. "Not found" is never
   * kept this long: a post deleted since must not reappear because the API
   * happened to be down.
   */
  stale(key: string): Lookup<unknown> | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.keepUntil <= this.now()) return undefined;
    return entry.lookup.kind === 'found' ? entry.lookup : undefined;
  }

  set(key: string, lookup: Lookup<unknown>): void {
    const now = this.now();
    this.entries.delete(key);
    this.entries.set(key, {
      until: now + this.ttlMs,
      keepUntil: now + (lookup.kind === 'found' ? this.keepMs : this.ttlMs),
      lookup,
    });
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

/**
 * At most [perSecond] requests to the API a second, whoever is asking.
 *
 * The API gives this service a bucket of 3000 a minute. Somebody requesting
 * a different made-up id on every hit misses the cache every time; this is
 * what keeps them from spending that bucket, and every real visitor's with
 * it. Counted for the whole service rather than per visitor, because which
 * address a visitor really has is not something a server behind Render's
 * proxies can be sure of.
 */
export class Throttle {
  private windowStart = 0;
  private used = 0;

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const t = this.now();
    if (t - this.windowStart >= 1000) {
      this.windowStart = t;
      this.used = 0;
    }
    if (this.used >= this.perSecond) return false;
    this.used++;
    return true;
  }
}

export interface HttpApiOptions {
  apiUrl: string;
  pagesKey: string;
  fetch?: typeof fetch;
  memory?: Memory;
  throttle?: Throttle;
  timeoutMs?: number;
}

export class HttpApi implements Api {
  private readonly fetch: typeof fetch;
  private readonly memory: Memory;
  private readonly throttle: Throttle;
  private readonly timeoutMs: number;
  private readonly inFlight = new Map<string, Promise<Lookup<unknown>>>();

  constructor(private readonly options: HttpApiOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.memory = options.memory ?? new Memory(60_000, 5_000);
    // 30 a second is 1800 a minute: well inside the API's 3000 for this
    // service, with room left for a deploy's cold cache.
    this.throttle = options.throttle ?? new Throttle(30);
    // Long enough for an API on a free instance to wake up. A chat app
    // drawing a card may give up sooner; a person waits.
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  post(id: string) {
    return this.read<PublicPost>(`/public/posts/${encodeURIComponent(id)}`);
  }

  comment(id: string) {
    return this.read<PublicComment>(
      `/public/comments/${encodeURIComponent(id)}`,
    );
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

    const request = this.fetchOnce(path)
      .then((lookup) =>
        lookup.kind === 'down' ? (this.memory.stale(path) ?? lookup) : lookup,
      )
      .finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, request);
    return (await request) as Lookup<T>;
  }

  private async fetchOnce(path: string): Promise<Lookup<unknown>> {
    if (!this.throttle.take()) return { kind: 'down' };

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

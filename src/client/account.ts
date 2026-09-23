import { GameRecord, HallRow, Profile, earnedLook } from '../shared/career';
import { DEFAULT_LOOK, Look } from '../shared/types';

const KEY = 'rampart.account';
const PENDING = 'rampart.pending';

interface Reply<T> {
  status: number;
  data: (T & { error?: string }) | null;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

/**
 * The signed-in commander: session token and a cached copy of their profile (so menus work
 * offline). Results of games finished while offline wait in a queue until they can be sent.
 */
export class AccountClient {
  token = '';
  profile: Profile | null = null;
  /** Called whenever the profile or sign-in state changes. */
  onChange = () => {};

  constructor() {
    const saved = read<{ token?: string; profile?: Profile } | null>(KEY, null);
    if (saved?.token && saved.profile) {
      this.token = saved.token;
      this.profile = saved.profile;
    }
  }

  get signedIn(): boolean {
    return !!this.token && !!this.profile;
  }

  /** What you are wearing (nothing special for guests). */
  get look(): Look {
    return this.profile ? earnedLook(this.profile.look, this.profile.career.honours) : DEFAULT_LOOK;
  }

  private set(token: string, profile: Profile | null) {
    this.token = profile ? token : '';
    this.profile = profile;
    write(KEY, profile ? { token, profile } : null);
    this.onChange();
  }

  private async call<T>(path: string, body?: unknown): Promise<Reply<T>> {
    try {
      const res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }

  /** Signs in (or creates the account). Returns an error message, or null on success. */
  async enter(mode: 'login' | 'signup', name: string, password: string): Promise<string | null> {
    const r = await this.call<{ token: string; profile: Profile }>(`/api/account/${mode}`, { name, password });
    if (r.data?.token && r.data.profile) {
      this.set(r.data.token, r.data.profile);
      void this.flush();
      return null;
    }
    if (r.status === 0) return 'Cannot reach the server. Are you online?';
    return r.data?.error ?? 'Something went wrong. Try again.';
  }

  async logout() {
    const token = this.token;
    this.set('', null);
    write(PENDING, null);
    if (token) {
      try {
        await fetch('/api/account/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {
        /* offline: the session simply expires */
      }
    }
  }

  /** Fetches the latest profile; a revoked session signs you out. */
  async refresh() {
    if (!this.token) return;
    const r = await this.call<{ profile: Profile }>('/api/account/me');
    if (r.status === 401) this.set('', null);
    else if (r.data?.profile) this.set(this.token, r.data.profile);
  }

  async wear(look: Look): Promise<boolean> {
    const r = await this.call<{ profile: Profile }>('/api/account/look', look);
    if (r.data?.profile) this.set(this.token, r.data.profile);
    return !!r.data?.profile;
  }

  /**
   * Saves a finished game. Returns the honours it earned, or null if it could not be sent
   * right now (it is queued and retried later).
   */
  async submit(rec: GameRecord): Promise<string[] | null> {
    if (!this.signedIn) return null;
    const r = await this.call<{ profile: Profile; honours: string[] }>('/api/account/games', rec);
    if (r.data?.profile) {
      this.set(this.token, r.data.profile);
      return r.data.honours ?? [];
    }
    if (r.status === 401) {
      this.set('', null);
      return null;
    }
    if (r.status === 0 || r.status >= 500) {
      const q = read<GameRecord[]>(PENDING, []).filter((x) => x.id !== rec.id);
      write(PENDING, [...q, rec].slice(-50));
    }
    return null;
  }

  /** Sends games that were finished while offline. Returns the honours they earned. */
  async flush(): Promise<string[]> {
    const q = read<GameRecord[]>(PENDING, []);
    if (!q.length || !this.signedIn) return [];
    write(PENDING, null);
    const earned: string[] = [];
    for (const rec of q) earned.push(...((await this.submit(rec)) ?? []));
    return earned;
  }

  get pending(): number {
    return read<GameRecord[]>(PENDING, []).length;
  }

  async hall(): Promise<HallRow[] | null> {
    const r = await this.call<{ hall: HallRow[] }>('/api/hall');
    return r.data?.hall ?? null;
  }
}

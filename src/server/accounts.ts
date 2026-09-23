import { DurableObject } from 'cloudflare:workers';
import {
  GameRecord,
  HallRow,
  PASSWORD_MIN,
  Profile,
  RecentGame,
  accountId,
  applyRecord,
  earnedLook,
  loadCareer,
  parseRecord,
  recentOf,
  validAccountName,
} from '../shared/career';
import { DEFAULT_LOOK, Look } from '../shared/types';
import type { Env } from './env';

/**
 * PBKDF2 rounds for new passwords. Kept modest so a sign-in fits the free plan's CPU budget;
 * the count is stored per account, and older hashes are upgraded when their owner signs in.
 */
const PBKDF2_ITERATIONS = 25_000;
const SESSION_MS = 365 * 24 * 3600 * 1000;
/** Wrong passwords in a row before an account is locked for a while. */
const MAX_FAILS = 8;
const LOCK_MS = 5 * 60 * 1000;
const MAX_ACCOUNTS = 1000;
const RECENT_GAMES = 10;

type UserRow = {
  id: string;
  name: string;
  salt: string;
  hash: string;
  iter: number;
  created: number;
  fails: number;
  locked: number;
  career: string;
  look: string;
};

export type AuthResult = { ok: true; token: string; profile: Profile } | { ok: false; error: string };

/** The commander behind a session token, as the game rooms need it. */
export interface Seat {
  id: string;
  name: string;
  look: Look;
}

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

async function sha256(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Accounts, sign-in sessions and every commander's career, in one SQLite-backed object. */
export class Accounts extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, iter INTEGER NOT NULL,
      created INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
      career TEXT NOT NULL, look TEXT NOT NULL)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user TEXT NOT NULL, used INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS games (user TEXT NOT NULL, gid TEXT NOT NULL, at INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (user, gid))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS games_recent ON games (user, at)');
  }

  // ------------------------------------------------------------ helpers

  private user(id: string): UserRow | null {
    return this.sql.exec<UserRow>('SELECT * FROM users WHERE id = ?', id).toArray()[0] ?? null;
  }

  private async userOf(token: unknown): Promise<UserRow | null> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = await sha256(token);
    const row = this.sql.exec<{ user: string; used: number }>('SELECT user, used FROM sessions WHERE hash = ?', hash).toArray()[0];
    const now = Date.now();
    if (!row || now - row.used > SESSION_MS) return null;
    // Sessions stay alive while they are used (refreshed at most daily).
    if (now - row.used > 24 * 3600 * 1000) this.sql.exec('UPDATE sessions SET used = ? WHERE hash = ?', now, hash);
    return this.user(row.user);
  }

  private async newSession(id: string): Promise<string> {
    const token = randomHex(32);
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE used < ?', now - SESSION_MS);
    this.sql.exec('INSERT INTO sessions (hash, user, used) VALUES (?, ?, ?)', await sha256(token), id, now);
    return token;
  }

  private profileOf(u: UserRow): Profile {
    const career = loadCareer(parseJson(u.career));
    const recent = this.sql
      .exec<{ at: number; record: string }>('SELECT at, record FROM games WHERE user = ? ORDER BY at DESC LIMIT ?', u.id, RECENT_GAMES)
      .toArray()
      .flatMap((g): RecentGame[] => {
        const r = parseRecord(parseJson(g.record));
        return r ? [recentOf(r, g.at)] : [];
      });
    return { name: u.name, since: u.created, look: earnedLook(parseJson(u.look), career.honours), career, recent };
  }

  /** Adds a game to a career once (retries with the same id change nothing). Returns new honours. */
  private addGame(id: string, rec: GameRecord): string[] {
    return this.ctx.storage.transactionSync(() => {
      const u = this.user(id);
      if (!u) return [];
      const dup = this.sql.exec('SELECT 1 FROM games WHERE user = ? AND gid = ?', u.id, rec.id).toArray().length > 0;
      if (dup) return [];
      const now = Date.now();
      const career = loadCareer(parseJson(u.career));
      const earned = applyRecord(career, rec, now);
      this.sql.exec('INSERT INTO games (user, gid, at, record) VALUES (?, ?, ?, ?)', u.id, rec.id, now, JSON.stringify(rec));
      this.sql.exec('UPDATE users SET career = ? WHERE id = ?', JSON.stringify(career), u.id);
      return earned;
    });
  }

  // ------------------------------------------------------------- RPC API

  async signup(name: unknown, password: unknown): Promise<AuthResult> {
    const n = validAccountName(name);
    if (!n) return { ok: false, error: 'Names are 3-16 letters or numbers (spaces are fine).' };
    const pw = typeof password === 'string' ? password : '';
    if (pw.length < PASSWORD_MIN || pw.length > 128) return { ok: false, error: `Passwords need at least ${PASSWORD_MIN} characters.` };
    const id = accountId(n);
    if (this.user(id)) return { ok: false, error: 'That name is already taken.' };
    const count = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM users').one().n;
    if (count >= MAX_ACCOUNTS) return { ok: false, error: 'The realm is full.' };
    const salt = randomHex(16);
    const hash = await pbkdf2(pw, salt, PBKDF2_ITERATIONS);
    // Someone may have claimed the name while the password was hashing.
    if (this.user(id)) return { ok: false, error: 'That name is already taken.' };
    this.sql.exec(
      'INSERT INTO users (id, name, salt, hash, iter, created, career, look) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      n,
      salt,
      hash,
      PBKDF2_ITERATIONS,
      Date.now(),
      JSON.stringify(loadCareer(null)),
      JSON.stringify(DEFAULT_LOOK),
    );
    const u = this.user(id)!;
    return { ok: true, token: await this.newSession(id), profile: this.profileOf(u) };
  }

  async login(name: unknown, password: unknown): Promise<AuthResult> {
    const n = validAccountName(name);
    const found = n ? this.user(accountId(n)) : null;
    if (!found) return { ok: false, error: 'No commander by that name.' };
    const now = Date.now();
    if (found.locked > now) return { ok: false, error: 'Too many wrong passwords. Try again in a few minutes.' };
    const pw = typeof password === 'string' ? password.slice(0, 128) : '';
    const hash = await pbkdf2(pw, found.salt, found.iter);
    const u = this.user(found.id);
    if (!u) return { ok: false, error: 'No commander by that name.' };
    if (!sameHash(hash, u.hash)) {
      const fails = u.fails + 1;
      if (fails >= MAX_FAILS) this.sql.exec('UPDATE users SET fails = 0, locked = ? WHERE id = ?', now + LOCK_MS, u.id);
      else this.sql.exec('UPDATE users SET fails = ? WHERE id = ?', fails, u.id);
      return { ok: false, error: 'Wrong password.' };
    }
    this.sql.exec('UPDATE users SET fails = 0, locked = 0 WHERE id = ?', u.id);
    if (u.iter < PBKDF2_ITERATIONS) {
      const salt = randomHex(16);
      const upgraded = await pbkdf2(pw, salt, PBKDF2_ITERATIONS);
      this.sql.exec('UPDATE users SET salt = ?, hash = ?, iter = ? WHERE id = ?', salt, upgraded, PBKDF2_ITERATIONS, u.id);
    }
    return { ok: true, token: await this.newSession(u.id), profile: this.profileOf(u) };
  }

  async logout(token: unknown): Promise<void> {
    if (typeof token === 'string') this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256(token));
  }

  async me(token: unknown): Promise<Profile | null> {
    const u = await this.userOf(token);
    return u ? this.profileOf(u) : null;
  }

  /** Puts on a title, hat and trail (anything not yet earned is left off). */
  async wear(token: unknown, look: unknown): Promise<Profile | null> {
    const u = await this.userOf(token);
    if (!u) return null;
    const career = loadCareer(parseJson(u.career));
    this.sql.exec('UPDATE users SET look = ? WHERE id = ?', JSON.stringify(earnedLook(look, career.honours)), u.id);
    return this.profileOf(this.user(u.id)!);
  }

  /** A game played in the browser (campaign or against the computer). */
  async submit(token: unknown, record: unknown): Promise<{ profile: Profile; honours: string[] } | null> {
    const u = await this.userOf(token);
    const rec = parseRecord(record);
    if (!u || !rec || rec.kind === 'online') return null;
    const honours = this.addGame(u.id, rec);
    return { profile: this.profileOf(this.user(u.id)!), honours };
  }

  /** Called by a game room when an online game ends (the room ran the game, so it is trusted). */
  async recordOnline(id: string, record: GameRecord): Promise<string[]> {
    const rec = parseRecord(record);
    if (!rec || rec.kind !== 'online') return [];
    return this.addGame(id, rec);
  }

  /** Who is behind a session token, for seating them in a room. */
  async seat(token: unknown): Promise<Seat | null> {
    const u = await this.userOf(token);
    if (!u) return null;
    const career = loadCareer(parseJson(u.career));
    return { id: u.id, name: u.name, look: earnedLook(parseJson(u.look), career.honours) };
  }

  async hall(): Promise<HallRow[]> {
    return this.sql
      .exec<{ name: string; career: string; look: string }>('SELECT name, career, look FROM users')
      .toArray()
      .map((u) => {
        const c = loadCareer(parseJson(u.career));
        const best = Math.max(0, ...Object.values(c.modes).map((m) => m.best));
        return { name: u.name, title: earnedLook(parseJson(u.look), c.honours).title, games: c.games, wins: c.wins, honours: Object.keys(c.honours).length, best };
      })
      .sort((a, b) => b.wins - a.wins || b.honours - a.honours || b.games - a.games || a.name.localeCompare(b.name));
  }
}

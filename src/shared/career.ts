import {
  DEFAULT_LOOK,
  Difficulty,
  EXECUTIONS,
  Execution,
  GameState,
  HATS,
  Hat,
  Look,
  PEAK_STATS,
  PlayerStats,
  STAT_KEYS,
  TRAILS,
  Trail,
  emptyStats,
} from './types';

/**
 * Career records, achievements ("honours") and the cosmetics they unlock. Shared by the
 * accounts Durable Object (which keeps the records) and the client (which shows them).
 */

export type GameKind = 'campaign' | 'endless' | 'battle' | 'online';
export const GAME_KINDS: readonly GameKind[] = ['campaign', 'endless', 'battle', 'online'];
const DIFFS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** One finished game, from one commander's point of view. */
export interface GameRecord {
  /** Unique per game and player, so a retried upload is only counted once. */
  id: string;
  kind: GameKind;
  /** Fleet strength (campaign) or the computer players' skill (battle). */
  difficulty: Difficulty;
  won: boolean;
  /** Commanders in the game (you included), and how many of your rivals were people. */
  players: number;
  humans: number;
  /** 1 = highest score. */
  rank: number;
  score: number;
  /** Campaign level reached (0 in battles). */
  level: number;
  rounds: number;
  /** The punishment you dealt as the winner, or suffered as a loser. */
  fate: Execution | null;
  stats: PlayerStats;
}

export interface ModeRecord {
  played: number;
  won: number;
  best: number;
  /** Highest campaign level reached. */
  level: number;
}

export interface Career {
  games: number;
  wins: number;
  modes: Record<GameKind, ModeRecord>;
  /** Stats summed over every game (peak stats keep the best game instead). */
  totals: PlayerStats;
  /** Punishments handed out, by kind, and how many you have suffered. */
  dealt: Partial<Record<Execution, number>>;
  suffered: number;
  /** Achievement id -> when it was earned (ms). */
  honours: Record<string, number>;
}

export interface RecentGame {
  at: number;
  kind: GameKind;
  difficulty: Difficulty;
  won: boolean;
  score: number;
  rank: number;
  players: number;
  level: number;
}

/** What the accounts API returns for the signed-in commander. */
export interface Profile {
  name: string;
  since: number;
  look: Look;
  career: Career;
  recent: RecentGame[];
}

/** One line of the Hall of Fame. */
export interface HallRow {
  name: string;
  title: string;
  games: number;
  wins: number;
  honours: number;
  best: number;
}

// ------------------------------------------------------------ achievements

export interface Reward {
  title?: string;
  hat?: Hat;
  trail?: Trail;
}

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  reward: Reward;
  /** Checked after the game has been added to the career. */
  test: (r: GameRecord, c: Career) => boolean;
}

const battle = (r: GameRecord) => r.kind === 'battle' || r.kind === 'online';

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'victor',
    icon: '🏆',
    name: 'First Victory',
    desc: 'Win a battle against the computer or online.',
    reward: { title: 'the Victorious' },
    test: (r) => battle(r) && r.won,
  },
  {
    id: 'fleet',
    icon: '⚓',
    name: 'Fleet Breaker',
    desc: 'Complete the six-level campaign.',
    reward: { hat: 'tricorn' },
    test: (r) => r.kind === 'campaign' && r.won,
  },
  {
    id: 'fleet_hard',
    icon: '🔥',
    name: "Admiral's Bane",
    desc: 'Complete the campaign on Hard.',
    reward: { trail: 'fire' },
    test: (r) => r.kind === 'campaign' && r.won && r.difficulty === 'hard',
  },
  {
    id: 'endless',
    icon: '🌊',
    name: 'The Long Siege',
    desc: 'Reach level 10 of the Endless Siege.',
    reward: { title: 'the Unyielding' },
    test: (r) => r.kind === 'endless' && r.level >= 10,
  },
  {
    id: 'flagship',
    icon: '🏴‍☠️',
    name: 'Flagship Down',
    desc: 'Sink the pirate flagship.',
    reward: { title: 'the Pirate-Scourge' },
    test: (r) => r.stats.flagships > 0,
  },
  {
    id: 'eagle',
    icon: '🎯',
    name: 'Eagle Eye',
    desc: 'Against the fleet, land 45% of your shots in one game (50 shots or more).',
    reward: { trail: 'arcane' },
    test: (r) => !battle(r) && r.stats.shots >= 50 && r.stats.hits >= r.stats.shots * 0.45,
  },
  {
    id: 'breaker',
    icon: '🧱',
    name: 'Wall Breaker',
    desc: 'Destroy 75 enemy wall sections in one battle.',
    reward: { title: 'the Wall-Breaker' },
    test: (r) => r.stats.walls >= 75,
  },
  {
    id: 'ordnance',
    icon: '💣',
    name: 'Master of Ordnance',
    desc: 'Place 20 cannons in one game.',
    reward: { trail: 'smoke' },
    test: (r) => r.stats.cannons >= 20,
  },
  {
    id: 'baron',
    icon: '🗺️',
    name: 'Land Baron',
    desc: 'Hold 150 tiles of land inside your walls at once.',
    reward: { title: 'the Land Baron' },
    test: (r) => r.stats.maxLand >= 150,
  },
  {
    id: 'keeps',
    icon: '🏰',
    name: 'Keeper of Keeps',
    desc: 'Hold all five castles of your land in the campaign.',
    reward: { title: 'the Castellan' },
    test: (r) => r.stats.maxCastles >= 5,
  },
  {
    id: 'impregnable',
    icon: '🛡️',
    name: 'Impregnable',
    desc: 'Win a battle losing no more than 15 wall sections.',
    reward: { hat: 'helm' },
    test: (r) => battle(r) && r.won && r.stats.wallsLost <= 15,
  },
  {
    id: 'spotless',
    icon: '✨',
    name: 'Spotless Realm',
    desc: 'Earn the clean-land bonus in 5 rounds of one game.',
    reward: { title: 'the Tidy' },
    test: (r) => r.stats.cleanRounds >= 5,
  },
  {
    id: 'giant',
    icon: '⚔️',
    name: 'Giant Slayer',
    desc: 'Defeat three Hard computer commanders at once.',
    reward: { hat: 'horns' },
    test: (r) => r.kind === 'battle' && r.won && r.difficulty === 'hard' && r.players >= 4,
  },
  {
    id: 'champion',
    icon: '👑',
    name: 'Champion of the Realm',
    desc: 'Win an online game against another person.',
    reward: { hat: 'laurel' },
    test: (r) => r.kind === 'online' && r.won && r.humans > 0,
  },
  {
    id: 'merciless',
    icon: '🪓',
    name: 'Cruel and Unusual',
    desc: 'Deal out every punishment at least once.',
    reward: { hat: 'hood' },
    test: (_r, c) => EXECUTIONS.every((m) => (c.dealt[m] ?? 0) > 0),
  },
  {
    id: 'glutton',
    icon: '🤡',
    name: 'Glutton for Punishment',
    desc: 'Suffer 10 punishments.',
    reward: { hat: 'jester' },
    test: (_r, c) => c.suffered >= 10,
  },
  {
    id: 'veteran',
    icon: '🎖️',
    name: 'Veteran',
    desc: 'Play 25 games.',
    reward: { hat: 'wizard' },
    test: (_r, c) => c.games >= 25,
  },
  {
    id: 'warlord',
    icon: '🐉',
    name: 'Warlord',
    desc: 'Win 10 battles or online games.',
    reward: { title: 'the Warlord' },
    test: (_r, c) => c.modes.battle.won + c.modes.online.won >= 10,
  },
  {
    id: 'gunner',
    icon: '💥',
    name: 'A Thousand Cannonballs',
    desc: 'Fire 1,000 cannonballs.',
    reward: { trail: 'gold' },
    test: (_r, c) => c.totals.shots >= 1000,
  },
  {
    id: 'siege',
    icon: '🏚️',
    name: 'Siege Master',
    desc: 'Destroy 1,000 enemy wall sections in total.',
    reward: { title: 'the Siege Master' },
    test: (_r, c) => c.totals.walls >= 1000,
  },
  {
    id: 'gravedigger',
    icon: '⛏️',
    name: 'Gravedigger',
    desc: 'Fill 100 craters.',
    reward: { title: 'the Gravedigger' },
    test: (_r, c) => c.totals.craters >= 100,
  },
  {
    id: 'ratcatcher',
    icon: '🐀',
    name: 'Ratcatcher',
    desc: 'Squash 25 landing troops.',
    reward: { title: 'the Ratcatcher' },
    test: (_r, c) => c.totals.grunts >= 25,
  },
  {
    id: 'seawolf',
    icon: '🚢',
    name: 'Sea Wolf',
    desc: 'Sink 100 ships.',
    reward: { title: 'the Sea Wolf' },
    test: (_r, c) => c.totals.ships >= 100,
  },
];

export const achievement = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

// ---------------------------------------------------------------- cosmetics

export const HAT_NAMES: Record<Hat, string> = {
  crown: 'Golden crown',
  tricorn: "Admiral's tricorn",
  helm: 'Great helm',
  horns: 'Horned helm',
  laurel: 'Laurel wreath',
  hood: "Headsman's hood",
  wizard: "Wizard's hat",
  jester: "Fool's cap",
};

export const TRAIL_NAMES: Record<Trail, string> = {
  none: 'Plain shot',
  smoke: 'Black powder smoke',
  fire: 'Greek fire',
  gold: 'Gilded sparks',
  arcane: 'Arcane wisps',
};

export const TITLES: readonly string[] = ACHIEVEMENTS.flatMap((a) => (a.reward.title ? [a.reward.title] : []));

/**
 * Computer commanders' epithets, one per seat, hinting at their skill ("Baron Cog the Hapless").
 * No honour unlocks these, so people cannot wear them.
 */
export const CPU_TITLES: Record<Difficulty, readonly string[]> = {
  easy: ['the Befuddled', 'the Dithering', 'the Hapless', 'the Unready'],
  normal: ['the Stout', 'the Shrewd', 'the Stubborn', 'the Bold'],
  hard: ['the Grim', 'the Merciless', 'the Terrible', 'the Dreadful'],
};
const CPU_TITLE_SET = new Set(Object.values(CPU_TITLES).flat());
/** Seat by seat: Sir Bot's great helm, Lady Byte's wizard's hat, Baron Cog's horns, Duke Relay's tricorn. */
const CPU_HATS: readonly Hat[] = ['helm', 'wizard', 'horns', 'tricorn'];

/** What the computer commander in a seat wears. */
export function cpuLook(seat: number, difficulty: Difficulty): Look {
  const i = ((Math.round(seat) % 4) + 4) % 4;
  return { title: (CPU_TITLES[difficulty] ?? CPU_TITLES.normal)[i], hat: CPU_HATS[i], trail: DEFAULT_LOOK.trail };
}

/** The achievement that unlocks a cosmetic (undefined for the free defaults). */
export function unlockedBy(kind: keyof Reward, value: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.reward[kind] === value);
}

export function isUnlocked(kind: keyof Reward, value: string, honours: Record<string, number>): boolean {
  if (value === DEFAULT_LOOK[kind]) return true;
  const a = unlockedBy(kind, value);
  return !!a && !!honours[a.id];
}

/** Any well-formed look (unknown items fall back to the defaults). */
export function validLook(l: unknown): Look {
  const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
  return {
    title: TITLES.includes(o.title as string) || CPU_TITLE_SET.has(o.title as string) ? (o.title as string) : DEFAULT_LOOK.title,
    hat: HATS.includes(o.hat as Hat) ? (o.hat as Hat) : DEFAULT_LOOK.hat,
    trail: TRAILS.includes(o.trail as Trail) ? (o.trail as Trail) : DEFAULT_LOOK.trail,
  };
}

/** A look with everything that has not been earned yet taken off. */
export function earnedLook(l: unknown, honours: Record<string, number>): Look {
  const v = validLook(l);
  return {
    title: isUnlocked('title', v.title, honours) ? v.title : DEFAULT_LOOK.title,
    hat: isUnlocked('hat', v.hat, honours) ? v.hat : DEFAULT_LOOK.hat,
    trail: isUnlocked('trail', v.trail, honours) ? v.trail : DEFAULT_LOOK.trail,
  };
}

/** "Sam the Tidy". */
export const styledName = (name: string, look?: Look | null) => (look?.title ? `${name} ${look.title}` : name);

// ------------------------------------------------------------------- careers

export function newCareer(): Career {
  const modes = {} as Record<GameKind, ModeRecord>;
  for (const k of GAME_KINDS) modes[k] = { played: 0, won: 0, best: 0, level: 0 };
  return { games: 0, wins: 0, modes, totals: emptyStats(), dealt: {}, suffered: 0, honours: {} };
}

const num = (v: unknown, max = 1e7) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

/** Fills in anything missing from a stored career (older records, new stats). */
export function loadCareer(v: unknown): Career {
  const c = newCareer();
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Career>;
  c.games = num(o.games);
  c.wins = num(o.wins);
  for (const k of GAME_KINDS) {
    const m = (o.modes?.[k] ?? {}) as Partial<ModeRecord>;
    c.modes[k] = { played: num(m.played), won: num(m.won), best: num(m.best, 1e9), level: num(m.level) };
  }
  for (const k of STAT_KEYS) c.totals[k] = num(o.totals?.[k], 1e9);
  for (const m of EXECUTIONS) if (o.dealt?.[m]) c.dealt[m] = num(o.dealt[m]);
  c.suffered = num(o.suffered);
  for (const a of ACHIEVEMENTS) if (o.honours?.[a.id]) c.honours[a.id] = num(o.honours[a.id], 1e14);
  return c;
}

/** Checks a game record sent by a client; returns null when it is malformed. */
export function parseRecord(v: unknown): GameRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w:.-]{6,64}$/.test(o.id)) return null;
  if (!GAME_KINDS.includes(o.kind as GameKind)) return null;
  const stats = emptyStats();
  const st = (o.stats && typeof o.stats === 'object' ? o.stats : {}) as Record<string, unknown>;
  for (const k of STAT_KEYS) stats[k] = num(st[k], 100000);
  stats.hits = Math.min(stats.hits, stats.shots);
  const players = Math.max(1, Math.min(4, num(o.players)));
  return {
    id: o.id,
    kind: o.kind as GameKind,
    difficulty: DIFFS.includes(o.difficulty as Difficulty) ? (o.difficulty as Difficulty) : 'normal',
    won: o.won === true,
    players,
    humans: Math.min(players - 1, num(o.humans)),
    rank: Math.max(1, Math.min(players, num(o.rank) || 1)),
    score: num(o.score, 1e9),
    level: num(o.level, 10000),
    rounds: num(o.rounds, 10000),
    fate: EXECUTIONS.includes(o.fate as Execution) ? (o.fate as Execution) : null,
    stats,
  };
}

/** Adds a finished game to a career. Returns the ids of any honours it earned. */
export function applyRecord(c: Career, r: GameRecord, now = Date.now()): string[] {
  c.games++;
  if (r.won) c.wins++;
  const m = c.modes[r.kind];
  m.played++;
  if (r.won) m.won++;
  m.best = Math.max(m.best, r.score);
  m.level = Math.max(m.level, r.level);
  for (const k of STAT_KEYS) c.totals[k] = PEAK_STATS.includes(k) ? Math.max(c.totals[k], r.stats[k]) : c.totals[k] + r.stats[k];
  if (r.fate) {
    if (r.won) c.dealt[r.fate] = (c.dealt[r.fate] ?? 0) + 1;
    else c.suffered++;
  }
  const earned: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (c.honours[a.id] || !a.test(r, c)) continue;
    c.honours[a.id] = now;
    earned.push(a.id);
  }
  return earned;
}

/** The record of a finished game for player `pid`. */
export function recordFor(s: GameState, pid: number, kind: GameKind, id: string, humans = 0): GameRecord {
  const p = s.players[pid];
  const won = s.solo ? s.solo.victory : s.winner === pid;
  const rivals = s.players.filter((o) => o.id !== pid);
  return {
    id,
    kind,
    difficulty: s.solo ? s.solo.difficulty : kind === 'battle' ? (rivals[0]?.difficulty ?? 'normal') : 'normal',
    won,
    players: s.players.length,
    humans,
    rank: 1 + rivals.filter((o) => o.score > p.score).length,
    score: p.score,
    level: s.solo?.level ?? 0,
    rounds: s.round,
    fate: s.execution,
    stats: { ...p.stats },
  };
}

export const recentOf = (r: GameRecord, at: number): RecentGame => ({
  at,
  kind: r.kind,
  difficulty: r.difficulty,
  won: r.won,
  score: r.score,
  rank: r.rank,
  players: r.players,
  level: r.level,
});

// ------------------------------------------------------------------ accounts

/** Commander names: 3-16 letters, digits, spaces and a little punctuation. */
export function validAccountName(v: unknown): string | null {
  const s = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} '_.-]{1,14}[\p{L}\p{N}.]$/u.test(s) ? s : null;
}

/** Names are unique regardless of case and spacing. */
export const accountId = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

export const PASSWORD_MIN = 6;

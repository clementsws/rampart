import type { Difficulty, Mode } from './types';

/** Game tuning. Times are in seconds, distances in tiles. */
export const TICK = 0.05;

export const SELECT_TIME = 15;
export const AUTOBUILD_TIME = 2.5;
export const CANNON_TIME = 12;
export const FIRST_CANNON_TIME = 15;
export const COMBAT_READY = 2.5;
export const COMBAT_TIME = 20;
export const SOLO_COMBAT_TIME = 24;
/** Longest wait after "cease fire" for balls still in the air (the longest flight fits). */
export const CEASEFIRE_MAX = 6.5;
export const BUILD_TIME = 25;
export const SUMMARY_TIME = 3.5;

/**
 * Cannonballs are lobbed: flight time grows with distance (a little faster than linearly),
 * so long shots fly high and take a while. Battles use slower balls than the campaign,
 * where the ships already move quickly enough to be hard to hit.
 */
const BALL_FLIGHT: Record<Mode, { min: number; speed: number; lob: number }> = {
  solo: { min: 0.45, speed: 9.5, lob: 900 },
  versus: { min: 0.5, speed: 7.5, lob: 450 },
};
export const BALL_MAX_TIME = 6;

export function flightTime(mode: Mode, dist: number): number {
  const f = BALL_FLIGHT[mode] ?? BALL_FLIGHT.versus;
  return Math.min(BALL_MAX_TIME, f.min + dist / f.speed + (dist * dist) / f.lob);
}

/** Peak height of a cannonball's arc (tiles), used for drawing. */
export function arcHeight(dist: number): number {
  return Math.min(12, 0.6 + dist * 0.3 + dist * dist * 0.01);
}

export const CANNON_HP = 3;
export const CRATER_ROUNDS = 2;
/** Craters each player can fill in (tap a crater) during every build phase. */
export const FILLS_PER_BUILD = 3;

export const SCORE_WALL = 50;
export const SCORE_CANNON_HIT = 50;
export const SCORE_CANNON_KILL = 250;
/** Per ship kind: sloop, frigate, galleon, flagship. */
export const SCORE_SHIP = [300, 600, 1000, 3000];
export const SCORE_GRUNT = 150;
export const SCORE_CASTLE = 400;
export const SCORE_HOME = 600;
export const SCORE_TILE = 5;
export const SCORE_BONUS_SQUARE = 300;
export const SCORE_CLEAN = 250;
export const SCORE_LEVEL = 1000;

export const DEFAULT_ROUNDS = 8;
export const SOLO_LEVELS = 6;

export interface LevelDef {
  /** Ships in each wave. The next wave sails once the previous one is sunk (or after waveGap). */
  waves: number[];
  /** Spawn weights for [sloop, frigate, galleon]. */
  kinds: number[];
  /** The last ship of the last wave is the pirate flagship. */
  boss: boolean;
  fireInterval: number;
  speed: number;
  gruntChance: number;
  /** Ship gunners' aim error (tiles). */
  aim: number;
  /** Balls in a galleon's broadside (the flagship always fires three). */
  broadside: number;
  /** Seconds after a wave sets sail before the next one follows, even if ships remain. */
  waveGap: number;
}

type BaseLevel = Pick<LevelDef, 'waves' | 'kinds' | 'fireInterval' | 'speed' | 'gruntChance' | 'aim'>;

/** The six campaign levels on normal difficulty. */
const BASE_LEVELS: BaseLevel[] = [
  { waves: [3, 3], kinds: [1, 0, 0], fireInterval: 4.2, speed: 0.95, gruntChance: 0, aim: 0.55 },
  { waves: [3, 4], kinds: [3, 1, 0], fireInterval: 3.7, speed: 1.0, gruntChance: 0.3, aim: 0.5 },
  { waves: [3, 3, 4], kinds: [3, 2, 1], fireInterval: 3.3, speed: 1.05, gruntChance: 0.5, aim: 0.46 },
  { waves: [4, 4, 4], kinds: [2, 2, 1], fireInterval: 3.0, speed: 1.1, gruntChance: 0.6, aim: 0.42 },
  { waves: [4, 4, 5], kinds: [2, 3, 2], fireInterval: 2.7, speed: 1.18, gruntChance: 0.7, aim: 0.38 },
  { waves: [4, 5, 5], kinds: [1, 3, 3], fireInterval: 2.4, speed: 1.25, gruntChance: 0.8, aim: 0.34 },
];

/** Level definition for a campaign level (levels past 6 are the endless siege). */
export function levelDef(level: number, difficulty: Difficulty = 'normal'): LevelDef {
  let base: BaseLevel;
  if (level <= BASE_LEVELS.length) {
    base = BASE_LEVELS[Math.max(1, level) - 1];
  } else {
    // Endless: more and bigger waves, faster and more accurate gunners.
    const k = level - BASE_LEVELS.length;
    const count = Math.min(6, 3 + Math.floor(k / 2));
    const size = Math.min(8, 5 + Math.floor(k / 3));
    base = {
      waves: Array.from({ length: count }, (_, i) => size - (i === 0 ? 1 : 0)),
      kinds: [1, 3, 3 + k],
      fireInterval: Math.max(1.5, 2.4 - 0.1 * k),
      speed: Math.min(1.6, 1.25 + 0.04 * k),
      gruntChance: 0.85,
      aim: Math.max(0.22, 0.34 - 0.015 * k),
    };
  }
  const bossEvery = difficulty === 'hard' ? 3 : 6;
  const def: LevelDef = {
    ...base,
    waves: [...base.waves],
    boss: difficulty !== 'easy' && level % bossEvery === 0,
    broadside: level >= (difficulty === 'hard' ? 3 : 5) ? 2 : 1,
    waveGap: 13,
  };
  if (difficulty === 'easy') {
    def.waves = def.waves.map((n) => Math.max(2, Math.round(n * 0.7)));
    def.fireInterval *= 1.25;
    def.aim *= 1.3;
    def.speed *= 0.9;
    def.gruntChance *= 0.5;
    def.broadside = 1;
    def.waveGap = 16;
  } else if (difficulty === 'hard') {
    def.waves = def.waves.map((n) => n + 1);
    def.fireInterval *= 0.8;
    def.aim *= 0.8;
    def.speed *= 1.1;
    def.gruntChance = Math.min(1, def.gruntChance + 0.25);
    def.waveGap = 10;
  }
  return def;
}

/** Per ship kind: sloop, frigate, galleon, flagship. */
export const SHIP_HP = [1, 2, 3, 6];
export const SHIP_SPEED = [2.2, 1.6, 1.2, 0.9];
export const SHIP_RADIUS = [0.8, 0.9, 1.05, 1.35];
export const SHIP_FLAGSHIP = 3;
export const SHIP_RANGE = 14;
/** Most ships afloat at once; later ships of a wave wait at the horizon. */
export const MAX_AT_SEA = 8;
/** Pause between the last ship of a wave sinking and the next wave setting sail. */
export const WAVE_LULL = 2.5;
export const MAX_GRUNTS = 8;
export const GRUNT_MOVE_TIME = 0.9;
export const GRUNT_ATTACK_TIME = 2.5;

export const PLAYER_COLORS = ['#3f6df2', '#e0404f', '#f2b705', '#a24de8'];
export const PLAYER_NAMES_DEFAULT = ['Blue', 'Red', 'Gold', 'Purple'];

export const AI_NAMES = ['Sir Bot', 'Lady Byte', 'Baron Cog', 'Duke Relay'];

export interface FactionDef {
  key: string;
  name: string;
  /** What their stronghold is called. */
  castle: string;
  crest: string;
}

/** Cosmetic factions: each has its own wall and castle architecture. */
export const FACTIONS: FactionDef[] = [
  { key: 'kingdom', name: 'Kingdom', castle: 'Stone Keep', crest: '🛡️' },
  { key: 'norse', name: 'Norse', castle: 'Timber Longhall', crest: '🪓' },
  { key: 'sultanate', name: 'Sultanate', castle: 'Sandstone Palace', crest: '🌙' },
  { key: 'shogunate', name: 'Shogunate', castle: 'Pagoda Castle', crest: '🏯' },
  { key: 'aztec', name: 'Aztec', castle: 'Sun Temple', crest: '☀️' },
  { key: 'celtic', name: 'Celtic', castle: 'Hill Fort', crest: '🍀' },
];

export const validFaction = (f: unknown): number => {
  const n = Math.round(Number(f));
  return Number.isInteger(n) && n >= 0 && n < FACTIONS.length ? n : 0;
};

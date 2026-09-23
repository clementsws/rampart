/** Game tuning. Times are in seconds, distances in tiles. */
export const TICK = 0.05;

export const SELECT_TIME = 15;
export const AUTOBUILD_TIME = 2.5;
export const CANNON_TIME = 12;
export const FIRST_CANNON_TIME = 15;
export const COMBAT_READY = 2.5;
export const COMBAT_TIME = 18;
export const SOLO_COMBAT_TIME = 20;
export const CEASEFIRE_MAX = 4;
export const BUILD_TIME = 25;
export const SUMMARY_TIME = 3.5;

export const BALL_SPEED = 11;
export const BALL_MIN_TIME = 0.35;
export const CANNON_HP = 3;
export const CRATER_ROUNDS = 2;

export const SCORE_WALL = 50;
export const SCORE_CANNON_HIT = 50;
export const SCORE_CANNON_KILL = 250;
export const SCORE_SHIP = [300, 600, 1000];
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
  total: number;
  maxAtSea: number;
  kinds: number[];
  fireInterval: number;
  speed: number;
  gruntChance: number;
  /** Ship gunners' aim error (tiles). */
  aim: number;
}

/** Fixed set of six single-player levels. kinds = spawn weights for [sloop, frigate, galleon]. */
export const LEVELS: LevelDef[] = [
  { total: 5, maxAtSea: 3, kinds: [1, 0, 0], fireInterval: 4.6, speed: 0.9, gruntChance: 0, aim: 0.6 },
  { total: 6, maxAtSea: 3, kinds: [3, 1, 0], fireInterval: 4.0, speed: 1.0, gruntChance: 0, aim: 0.55 },
  { total: 7, maxAtSea: 4, kinds: [3, 2, 1], fireInterval: 3.4, speed: 1.05, gruntChance: 0.5, aim: 0.5 },
  { total: 8, maxAtSea: 4, kinds: [2, 2, 1], fireInterval: 3.0, speed: 1.1, gruntChance: 0.6, aim: 0.45 },
  { total: 9, maxAtSea: 5, kinds: [2, 3, 2], fireInterval: 2.6, speed: 1.2, gruntChance: 0.7, aim: 0.4 },
  { total: 10, maxAtSea: 5, kinds: [1, 3, 3], fireInterval: 2.3, speed: 1.3, gruntChance: 0.8, aim: 0.35 },
];

export const SHIP_HP = [1, 2, 3];
export const SHIP_SPEED = [2.2, 1.6, 1.2];
export const SHIP_RADIUS = [0.8, 0.9, 1.05];
export const SHIP_RANGE = 14;
export const MAX_GRUNTS = 8;
export const GRUNT_MOVE_TIME = 0.9;
export const GRUNT_ATTACK_TIME = 2.5;

export const PLAYER_COLORS = ['#3f6df2', '#e0404f', '#f2b705', '#a24de8'];
export const PLAYER_NAMES_DEFAULT = ['Blue', 'Red', 'Gold', 'Purple'];

export const AI_NAMES = ['Sir Bot', 'Lady Byte', 'Baron Cog', 'Duke Relay'];

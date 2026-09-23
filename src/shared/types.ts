export type Mode = 'solo' | 'versus';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Phase = 'select' | 'autobuild' | 'cannons' | 'combat' | 'build' | 'summary' | 'gameover';
export type Execution = 'plank' | 'behead';

export const WATER = 0;
export const LAND = 1;

export interface Player {
  id: number;
  name: string;
  ai: boolean;
  difficulty: Difficulty;
  alive: boolean;
  score: number;
  /** Castle id of the home castle, -1 before selection. */
  home: number;
  /** Current wall piece shape (-1 when not building). */
  piece: number;
  next: number;
  /** Number of pieces placed so far; used to de-duplicate network actions. */
  pieceSeq: number;
  cannonsToPlace: number;
  cursorX: number;
  cursorY: number;
  rot: number;
  castles: number;
  territory: number;
  connected: boolean;
  /** Round in which the player was eliminated (0 = still alive). */
  outRound: number;
}

export interface Castle {
  id: number;
  x: number;
  y: number;
  region: number;
  owner: number;
}

export interface Cannon {
  id: number;
  owner: number;
  x: number;
  y: number;
  hp: number;
  active: boolean;
  busy: boolean;
  angle: number;
}

export interface Ball {
  id: number;
  owner: number;
  cannon: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
}

export interface Ship {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  /** >0 while sinking: time the sinking started. */
  sinkT: number;
  reload: number;
  wx: number;
  wy: number;
  grunts: number;
  dropT: number;
  /** Anchored (not moving) until this time. */
  holdT: number;
  /** Currently sailing a patrol leg along the firing line. */
  patrol: boolean;
}

export interface Grunt {
  id: number;
  x: number;
  y: number;
  moveT: number;
  attackT: number;
}

export interface SoloState {
  level: number;
  total: number;
  remaining: number;
  sunk: number;
  levelDone: boolean;
  spawnT: number;
  victory: boolean;
}

export interface SummaryRow {
  p: number;
  castles: number;
  territory: number;
  bonus: number;
  clean: number;
  total: number;
}

export interface GameState {
  mode: Mode;
  W: number;
  H: number;
  seed: number;
  terrain: Uint8Array;
  region: Int8Array;
  bonus: Uint8Array;
  wall: Int8Array;
  territory: Int8Array;
  crater: Uint8Array;
  rubble: Uint8Array;
  castles: Castle[];
  cannons: Cannon[];
  balls: Ball[];
  ships: Ship[];
  grunts: Grunt[];
  players: Player[];
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  fireStart: number;
  fireEnd: number;
  time: number;
  round: number;
  maxRounds: number;
  solo: SoloState | null;
  winner: number;
  execution: Execution | null;
  summary: SummaryRow[];
  /** Bumped whenever wall/territory/crater/rubble change. */
  gridVersion: number;
}

export type Action =
  | { type: 'select'; castle: number }
  | { type: 'place'; x: number; y: number; rot: number; seq: number }
  | { type: 'cannon'; x: number; y: number }
  | { type: 'fire'; x: number; y: number }
  | { type: 'cursor'; x: number; y: number; rot: number }
  | { type: 'execute'; method: Execution };

export type BoomKind = 'wall' | 'ground' | 'water' | 'cannon' | 'ship' | 'castle' | 'grunt' | 'dud';

export type GameEvent =
  | { e: 'phase'; phase: Phase; round: number; level: number }
  | { e: 'place'; p: number; cells: number[] }
  | { e: 'cannon'; p: number; x: number; y: number }
  | { e: 'fire'; p: number; x: number; y: number }
  | { e: 'boom'; x: number; y: number; kind: BoomKind }
  | { e: 'sink'; x: number; y: number }
  | { e: 'castle'; p: number; id: number }
  | { e: 'eliminated'; p: number }
  | { e: 'level'; level: number }
  | { e: 'levelComplete'; level: number; bonus: number }
  | { e: 'score'; p: number; amount: number; x: number; y: number }
  | { e: 'grunt'; x: number; y: number }
  | { e: 'gameover'; winner: number }
  | { e: 'execute'; method: Execution };

export const idx = (s: { W: number }, x: number, y: number) => y * s.W + x;

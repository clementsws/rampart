import { validLook } from './career';
import type { Game } from './engine';
import { Ball, Difficulty, Execution, GameEvent, GameState, Hat, Mode, Phase, Player, STAT_KEYS, SummaryRow, Trail, emptyStats } from './types';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

// ------------------------------------------------------------ lobby types

export type SlotKind = 'open' | 'human' | 'ai';

export interface SlotInfo {
  kind: SlotKind;
  name: string;
  /** Title earned by a signed-in commander, or a computer's epithet ('' for guests). */
  title: string;
  /** Victory hat, shown on the commander's portrait. */
  hat: Hat;
  difficulty: Difficulty;
  faction: number;
  connected: boolean;
}

export interface LobbyInfo {
  code: string;
  slots: SlotInfo[];
  host: number;
  rounds: number;
  inGame: boolean;
}

// ----------------------------------------------------------- client -> server

export type ClientMsg =
  /** `auth` is the account session token of a signed-in commander. */
  | { t: 'hello'; name: string; token: string; faction?: number; auth?: string }
  | { t: 'slot'; slot: number; kind: 'ai' | 'open'; difficulty?: Difficulty }
  | { t: 'faction'; slot: number; faction: number }
  | { t: 'rounds'; rounds: number }
  | { t: 'start' }
  | { t: 'lobby' }
  | { t: 'a'; a: import('./types').Action }
  | { t: 'ping'; c: number };

// ----------------------------------------------------------- server -> client

export interface StaticMap {
  mode: Mode;
  W: number;
  H: number;
  seed: number;
  terrain: string;
  region: string;
  bonus: string;
  castles: [number, number, number][];
}

export interface TickMsg {
  t: 's';
  time: number;
  ph: Phase;
  ps: number;
  pe: number;
  fs: number;
  fe: number;
  rd: number;
  mr: number;
  win: number;
  ex: Execution | null;
  solo: number[] | null;
  pl: number[][];
  /** Names, skill, faction and cosmetics (title, hat, trail). */
  pn?: [string, Difficulty, number, string, Hat, Trail][];
  /** Grid: idx/code pairs, or every code when gf is set. */
  g?: number[];
  gf?: 1;
  cs?: number[];
  cn?: number[][];
  nb?: number[][];
  bl?: number[][];
  sh?: number[][];
  gr?: number[][];
  ev?: GameEvent[];
  sum?: SummaryRow[];
  /** Every player's stats in STAT_KEYS order (sent with each phase change). */
  st?: number[][];
}

export type ServerMsg =
  | { t: 'welcome'; token: string; slot: number }
  | { t: 'lobby'; lobby: LobbyInfo; you: number }
  | { t: 'init'; you: number; map: StaticMap; state: TickMsg }
  | TickMsg
  | { t: 'pong'; c: number; time: number }
  /** Honours (achievement ids) the finished game earned for your account. */
  | { t: 'honours'; ids: string[] }
  | { t: 'error'; msg: string };

// ------------------------------------------------------------------ encode

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function gridCode(s: GameState, i: number): number {
  return s.wall[i] + 1 + 5 * (s.territory[i] + 1) + 25 * Math.min(2, s.crater[i]) + 75 * (s.rubble[i] ? 1 : 0);
}

export function applyGridCode(s: GameState, i: number, code: number) {
  s.wall[i] = (code % 5) - 1;
  s.territory[i] = (Math.floor(code / 5) % 5) - 1;
  s.crater[i] = Math.floor(code / 25) % 3;
  s.rubble[i] = code >= 75 ? 1 : 0;
}

export function encodeStatic(s: GameState): StaticMap {
  let terrain = '';
  let region = '';
  let bonus = '';
  for (let i = 0; i < s.W * s.H; i++) {
    terrain += s.terrain[i];
    region += s.region[i] < 0 ? '.' : String(s.region[i]);
    bonus += s.bonus[i] ? '1' : '0';
  }
  return {
    mode: s.mode,
    W: s.W,
    H: s.H,
    seed: s.seed,
    terrain,
    region,
    bonus,
    castles: s.castles.map((c) => [c.x, c.y, c.region]),
  };
}

const encBall = (b: Ball) => [b.id, b.owner, b.cannon, r2(b.fx), r2(b.fy), r2(b.tx), r2(b.ty), r3(b.t0), r3(b.dur)];

/** Tracks what the clients already know so each tick only carries changes. */
export class Encoder {
  private lastSummary: SummaryRow[] | null = null;
  private hadMobiles = false;
  private statsPhase = '';

  constructor(private readonly game: Game) {}

  private base(): TickMsg {
    const s = this.game.s;
    return {
      t: 's',
      time: r3(s.time),
      ph: s.phase,
      ps: r3(s.phaseStart),
      pe: r3(s.phaseEnd),
      fs: r3(s.fireStart),
      fe: r3(s.fireEnd),
      rd: s.round,
      mr: s.maxRounds,
      win: s.winner,
      ex: s.execution,
      solo: s.solo
        ? [
            s.solo.level,
            s.solo.total,
            s.solo.remaining,
            s.solo.sunk,
            s.solo.levelDone ? 1 : 0,
            s.solo.victory ? 1 : 0,
            s.solo.wave,
            s.solo.waves,
            DIFFS.indexOf(s.solo.difficulty),
            s.solo.endless ? 1 : 0,
          ]
        : null,
      pl: s.players.map((p) => [
        p.score,
        p.alive ? 1 : 0,
        p.home,
        p.piece,
        p.next,
        p.pieceSeq,
        p.cannonsToPlace,
        p.cursorX,
        p.cursorY,
        p.rot,
        p.castles,
        p.territory,
        p.connected ? 1 : 0,
        p.ai ? 1 : 0,
        p.outRound,
        p.fills,
      ]),
    };
  }

  private mobiles(m: TickMsg) {
    const s = this.game.s;
    m.sh = s.ships.map((sh) => [sh.id, sh.kind, r3(sh.x), r3(sh.y), r2(sh.vx), r2(sh.vy), r2(sh.angle), sh.hp, r3(sh.sinkT)]);
    m.gr = s.grunts.map((g) => [g.id, g.x, g.y]);
  }

  private stats(): number[][] {
    return this.game.s.players.map((p) => STAT_KEYS.map((k) => p.stats[k]));
  }

  private cannons(): number[][] {
    return this.game.s.cannons.map((c) => [c.id, c.owner, c.x, c.y, c.hp, c.active ? 1 : 0, r2(c.angle)]);
  }

  full(): TickMsg {
    const g = this.game;
    const s = g.s;
    const m = this.base();
    m.pn = s.players.map((p) => [p.name, p.difficulty, p.faction, p.look.title, p.look.hat, p.look.trail]);
    m.st = this.stats();
    m.gf = 1;
    m.g = [];
    for (let i = 0; i < s.W * s.H; i++) m.g.push(gridCode(s, i));
    m.cs = s.castles.map((c) => c.owner);
    m.cn = this.cannons();
    m.bl = s.balls.map(encBall);
    m.sum = s.summary;
    this.mobiles(m);
    return m;
  }

  /** Changes since the previous delta. Consumes the game's dirty flags and events. */
  delta(): TickMsg {
    const g = this.game;
    const s = g.s;
    const m = this.base();
    if (g.dirty.size) {
      m.g = [];
      for (const i of g.dirty) m.g.push(i, gridCode(s, i));
      g.dirty.clear();
    }
    if (g.castlesChanged) {
      m.cs = s.castles.map((c) => c.owner);
      g.castlesChanged = false;
    }
    if (g.cannonsChanged) {
      m.cn = this.cannons();
      g.cannonsChanged = false;
    }
    if (g.newBalls.length) {
      m.nb = g.newBalls.map(encBall);
      g.newBalls = [];
    }
    const mobiles = s.ships.length > 0 || s.grunts.length > 0;
    if (mobiles || this.hadMobiles) this.mobiles(m);
    this.hadMobiles = mobiles;
    if (s.summary !== this.lastSummary) {
      m.sum = s.summary;
      this.lastSummary = s.summary;
    }
    if (s.phase !== this.statsPhase) {
      m.st = this.stats();
      this.statsPhase = s.phase;
    }
    const ev = g.drainEvents();
    if (ev.length) m.ev = ev;
    return m;
  }
}

// ------------------------------------------------------------------ decode

export function stateFromStatic(map: StaticMap): GameState {
  const N = map.W * map.H;
  const terrain = new Uint8Array(N);
  const region = new Int8Array(N);
  const bonus = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    terrain[i] = map.terrain.charCodeAt(i) - 48;
    const r = map.region[i];
    region[i] = r === '.' ? -1 : Number(r);
    bonus[i] = map.bonus[i] === '1' ? 1 : 0;
  }
  return {
    mode: map.mode,
    W: map.W,
    H: map.H,
    seed: map.seed,
    terrain,
    region,
    bonus,
    wall: new Int8Array(N).fill(-1),
    territory: new Int8Array(N).fill(-1),
    crater: new Uint8Array(N),
    rubble: new Uint8Array(N),
    castles: map.castles.map(([x, y, r], id) => ({ id, x, y, region: r, owner: -1 })),
    cannons: [],
    balls: [],
    ships: [],
    grunts: [],
    players: [],
    phase: 'select',
    phaseStart: 0,
    phaseEnd: 0,
    fireStart: 0,
    fireEnd: 0,
    time: 0,
    round: 1,
    maxRounds: 0,
    solo: null,
    winner: -1,
    execution: null,
    summary: [],
    gridVersion: 1,
  };
}

/** Applies a snapshot or delta to a client-side mirror of the game state. Returns its events. */
export function applyTick(s: GameState, m: TickMsg): GameEvent[] {
  s.time = m.time;
  s.phase = m.ph;
  s.phaseStart = m.ps;
  s.phaseEnd = m.pe;
  s.fireStart = m.fs;
  s.fireEnd = m.fe;
  s.round = m.rd;
  s.maxRounds = m.mr;
  s.winner = m.win;
  s.execution = m.ex;
  s.solo = m.solo
    ? {
        level: m.solo[0],
        total: m.solo[1],
        remaining: m.solo[2],
        sunk: m.solo[3],
        levelDone: !!m.solo[4],
        victory: !!m.solo[5],
        wave: m.solo[6] ?? 0,
        waves: m.solo[7] ?? 0,
        difficulty: DIFFS[m.solo[8]] ?? 'normal',
        endless: !!m.solo[9],
        waveLeft: 0,
        waveT: 0,
        spawnT: 0,
      }
    : null;
  m.pl.forEach((a, id) => {
    let p: Player = s.players[id];
    if (!p) {
      p = s.players[id] = {
        id,
        name: `Player ${id + 1}`,
        ai: false,
        difficulty: 'normal',
        faction: 0,
        alive: true,
        score: 0,
        home: -1,
        piece: -1,
        next: -1,
        pieceSeq: 0,
        cannonsToPlace: 0,
        fills: 0,
        cursorX: -1,
        cursorY: -1,
        rot: 0,
        castles: 0,
        territory: 0,
        connected: true,
        outRound: 0,
        look: validLook(null),
        stats: emptyStats(),
      };
    }
    [p.score] = a;
    p.alive = !!a[1];
    p.home = a[2];
    p.piece = a[3];
    p.next = a[4];
    p.pieceSeq = a[5];
    p.cannonsToPlace = a[6];
    p.cursorX = a[7];
    p.cursorY = a[8];
    p.rot = a[9];
    p.castles = a[10];
    p.territory = a[11];
    p.connected = !!a[12];
    p.ai = !!a[13];
    p.outRound = a[14];
    p.fills = a[15] ?? 0;
  });
  if (m.pn) {
    m.pn.forEach(([name, diff, faction, title, hat, trail], id) => {
      if (s.players[id]) {
        s.players[id].name = name;
        s.players[id].difficulty = diff;
        s.players[id].faction = faction ?? 0;
        s.players[id].look = validLook({ title, hat, trail });
      }
    });
  }
  if (m.st) {
    m.st.forEach((a, id) => {
      const p = s.players[id];
      if (p) STAT_KEYS.forEach((k, j) => (p.stats[k] = a[j] ?? 0));
    });
  }
  if (m.g) {
    if (m.gf) {
      for (let i = 0; i < m.g.length; i++) applyGridCode(s, i, m.g[i]);
    } else {
      for (let k = 0; k < m.g.length; k += 2) applyGridCode(s, m.g[k], m.g[k + 1]);
    }
    s.gridVersion++;
  }
  if (m.cs) m.cs.forEach((o, i) => s.castles[i] && (s.castles[i].owner = o));
  if (m.cn) {
    const oldAngles = new Map(s.cannons.map((c) => [c.id, c.angle]));
    s.cannons = m.cn.map(([id, owner, x, y, hp, active, angle]) => ({
      id,
      owner,
      x,
      y,
      hp,
      active: !!active,
      busy: false,
      angle: oldAngles.get(id) ?? angle,
    }));
  }
  const decBall = (a: number[]): Ball => ({
    id: a[0],
    owner: a[1],
    cannon: a[2],
    fx: a[3],
    fy: a[4],
    tx: a[5],
    ty: a[6],
    t0: a[7],
    dur: a[8],
  });
  if (m.bl) s.balls = m.bl.map(decBall);
  if (m.nb) {
    for (const a of m.nb) {
      const b = decBall(a);
      s.balls.push(b);
      const c = s.cannons.find((cn) => cn.id === b.cannon);
      if (c) c.angle = Math.atan2(b.ty - b.fy, b.tx - b.fx);
    }
  }
  if (m.sh) {
    s.ships = m.sh.map(([id, kind, x, y, vx, vy, angle, hp, sinkT]) => ({
      id,
      kind,
      x,
      y,
      vx,
      vy,
      angle,
      hp,
      sinkT,
      reload: 0,
      wx: x,
      wy: y,
      grunts: 0,
      dropT: 0,
      holdT: 0,
      patrol: false,
    }));
  }
  if (m.gr) s.grunts = m.gr.map(([id, x, y]) => ({ id, x, y, moveT: 0, attackT: 0 }));
  if (m.sum) s.summary = m.sum;
  return m.ev ?? [];
}

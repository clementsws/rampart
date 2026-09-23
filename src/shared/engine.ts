import { AIController } from './ai';
import {
  AUTOBUILD_TIME,
  BALL_MIN_TIME,
  BALL_SPEED,
  BUILD_TIME,
  CANNON_HP,
  CANNON_TIME,
  CEASEFIRE_MAX,
  COMBAT_READY,
  COMBAT_TIME,
  CRATER_ROUNDS,
  DEFAULT_ROUNDS,
  FIRST_CANNON_TIME,
  GRUNT_ATTACK_TIME,
  GRUNT_MOVE_TIME,
  LEVELS,
  MAX_GRUNTS,
  SCORE_BONUS_SQUARE,
  SCORE_CANNON_HIT,
  SCORE_CANNON_KILL,
  SCORE_CASTLE,
  SCORE_CLEAN,
  SCORE_GRUNT,
  SCORE_HOME,
  SCORE_LEVEL,
  SCORE_SHIP,
  SCORE_TILE,
  SCORE_WALL,
  SELECT_TIME,
  SHIP_HP,
  SHIP_RADIUS,
  SHIP_RANGE,
  SHIP_SPEED,
  SOLO_COMBAT_TIME,
  SOLO_LEVELS,
  SUMMARY_TIME,
} from './constants';
import { DIRS4, DIRS8, generateMap } from './mapgen';
import { PIECE_WEIGHTS, pieceCells } from './pieces';
import { Rng, randomSeed } from './rng';
import {
  buildable,
  canPlaceCannon,
  canPlacePiece,
  cannonAllowance,
  cannonAt,
  castleAt,
  computeEnclosed,
  hasCannonSpot,
  obstacleMap,
  OBS_CANNON,
  OBS_CASTLE,
} from './rules';
import {
  Action,
  Ball,
  BoomKind,
  Difficulty,
  GameEvent,
  GameState,
  LAND,
  Mode,
  Phase,
  Player,
  Ship,
  SummaryRow,
} from './types';

export interface PlayerConfig {
  name: string;
  ai: boolean;
  difficulty: Difficulty;
}

export interface GameConfig {
  mode: Mode;
  players: PlayerConfig[];
  seed?: number;
  rounds?: number;
}

const FAR = 0x7fff;

export class Game {
  readonly s: GameState;
  readonly rng: Rng;
  private pieceRng: Rng[];
  events: GameEvent[] = [];
  /** Tiles whose wall/territory/crater/rubble changed since the last drain. */
  dirty = new Set<number>();
  cannonsChanged = true;
  castlesChanged = true;
  newBalls: Ball[] = [];
  private nextId = 1;
  private autobuild: number[][] = [];
  private ais: AIController[];
  private landDist: Int16Array;
  private seaNear: Int16Array | null = null;
  private seaShore: Int16Array | null = null;

  constructor(cfg: GameConfig) {
    const seed = cfg.seed ?? randomSeed();
    const n = cfg.mode === 'solo' ? 1 : Math.max(2, Math.min(4, cfg.players.length));
    const map = generateMap(cfg.mode, n, seed);
    const N = map.W * map.H;
    this.rng = new Rng(seed ^ 0x5bd1e995);
    this.pieceRng = [];
    const players: Player[] = [];
    for (let i = 0; i < n; i++) {
      const pc = cfg.players[i] ?? { name: `CPU ${i + 1}`, ai: true, difficulty: 'normal' as Difficulty };
      this.pieceRng.push(new Rng(seed + 7919 * (i + 1)));
      players.push({
        id: i,
        name: pc.name,
        ai: pc.ai,
        difficulty: pc.difficulty,
        alive: true,
        score: 0,
        home: -1,
        piece: -1,
        next: -1,
        pieceSeq: 0,
        cannonsToPlace: 0,
        cursorX: -1,
        cursorY: -1,
        rot: 0,
        castles: 0,
        territory: 0,
        connected: true,
        outRound: 0,
      });
    }
    this.s = {
      mode: cfg.mode,
      W: map.W,
      H: map.H,
      seed,
      terrain: map.terrain,
      region: map.region,
      bonus: map.bonus,
      wall: new Int8Array(N).fill(-1),
      territory: new Int8Array(N).fill(-1),
      crater: new Uint8Array(N),
      rubble: new Uint8Array(N),
      castles: map.castles.map((c, id) => ({ id, x: c.x, y: c.y, region: c.region, owner: -1 })),
      cannons: [],
      balls: [],
      ships: [],
      grunts: [],
      players,
      phase: 'select',
      phaseStart: 0,
      phaseEnd: SELECT_TIME,
      fireStart: 0,
      fireEnd: 0,
      time: 0,
      round: 1,
      maxRounds: cfg.mode === 'solo' ? 0 : cfg.rounds ?? DEFAULT_ROUNDS,
      solo: cfg.mode === 'solo' ? { level: 1, total: 0, remaining: 0, sunk: 0, levelDone: false, spawnT: 0, victory: false } : null,
      winner: -1,
      execution: null,
      summary: [],
      gridVersion: 1,
    };
    this.landDist = this.computeLandDist();
    this.ais = players.map((p) => new AIController(this, p.id));
    for (const p of players) {
      const c = this.defaultCastle(p.id);
      if (c) {
        p.cursorX = c.x;
        p.cursorY = c.y;
      }
    }
    if (this.s.solo) this.setupLevel(1);
    this.emit({ e: 'phase', phase: 'select', round: 1, level: this.s.solo?.level ?? 0 });
  }

  // ---------------------------------------------------------------- helpers

  emit(ev: GameEvent) {
    this.events.push(ev);
  }

  drainEvents(): GameEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  private id(): number {
    return this.nextId++;
  }

  private markDirty(i: number) {
    this.dirty.add(i);
    this.s.gridVersion++;
  }

  private addScore(pid: number, amount: number, x: number, y: number) {
    const p = this.s.players[pid];
    if (!p) return;
    p.score += amount;
    this.emit({ e: 'score', p: pid, amount, x, y });
  }

  private setPhase(phase: Phase, duration: number) {
    const s = this.s;
    s.phase = phase;
    s.phaseStart = s.time;
    s.phaseEnd = s.time + duration;
    this.emit({ e: 'phase', phase, round: s.round, level: s.solo?.level ?? 0 });
    for (const ai of this.ais) ai.onPhase(phase);
  }

  private randomPiece(pid: number): number {
    return this.pieceRng[pid].weighted(PIECE_WEIGHTS);
  }

  alivePlayers(): Player[] {
    return this.s.players.filter((p) => p.alive);
  }

  /** Castle nearest the centre of the player's region (a sensible default home). */
  defaultCastle(pid: number) {
    const s = this.s;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < s.W * s.H; i++) {
      if (s.region[i] === pid) {
        sx += i % s.W;
        sy += Math.floor(i / s.W);
        n++;
      }
    }
    const cx = n ? sx / n : s.W / 2;
    const cy = n ? sy / n : s.H / 2;
    let best = null;
    let bd = Infinity;
    for (const c of s.castles) {
      if (c.region !== pid) continue;
      const d = (c.x + 1 - cx) ** 2 + (c.y + 1 - cy) ** 2 - (this.homeRing(c.id).complete ? 1000 : 0);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  setAI(pid: number, on: boolean) {
    const p = this.s.players[pid];
    if (p) p.ai = on;
  }

  // ------------------------------------------------------------- main loop

  tick(dt: number) {
    const s = this.s;
    s.time += dt;
    for (const ai of this.ais) if (s.players[ai.pid].ai) ai.tick();

    switch (s.phase) {
      case 'select':
        if (s.players.every((p) => !p.alive || p.home >= 0) || s.time >= s.phaseEnd) {
          for (const p of s.players) {
            if (p.home < 0) {
              const c = this.defaultCastle(p.id);
              if (c) p.home = c.id;
            }
          }
          this.startAutobuild();
        }
        break;
      case 'autobuild':
        this.tickAutobuild();
        break;
      case 'cannons':
        if (s.time >= s.phaseEnd || (s.time > s.phaseStart + 1 && s.players.every((p) => !p.alive || p.cannonsToPlace <= 0))) {
          this.startCombat();
        }
        break;
      case 'combat':
        this.tickCombat(dt);
        break;
      case 'build':
        if (s.time >= s.phaseEnd) this.endBuild();
        break;
      case 'summary':
        if (s.time >= s.phaseEnd) {
          s.round++;
          this.startCannons(false);
        }
        break;
      case 'gameover':
        if (s.mode === 'versus' && s.winner >= 0 && !s.execution) {
          const w = s.players[s.winner];
          if ((w.ai && s.time > s.phaseStart + 3) || s.time >= s.phaseEnd) {
            this.execute(this.rng.next() < 0.5 ? 'plank' : 'behead');
          }
        }
        break;
    }
    this.updateBalls();
  }

  // --------------------------------------------------------------- actions

  act(pid: number, a: Action): boolean {
    const s = this.s;
    const p = s.players[pid];
    if (!p || !a || typeof a !== 'object') return false;
    switch (a.type) {
      case 'cursor': {
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
        p.cursorX = Math.max(-2, Math.min(s.W + 1, Math.round(a.x)));
        p.cursorY = Math.max(-2, Math.min(s.H + 1, Math.round(a.y)));
        p.rot = ((Math.round(a.rot) % 4) + 4) % 4 || 0;
        return true;
      }
      case 'select': {
        if (s.phase !== 'select' || !p.alive) return false;
        const c = s.castles[a.castle];
        if (!c || c.region !== pid) return false;
        p.home = c.id;
        p.cursorX = c.x;
        p.cursorY = c.y;
        return true;
      }
      case 'place':
        return this.placePiece(pid, a.x, a.y, a.rot, a.seq);
      case 'cannon':
        return this.placeCannon(pid, a.x, a.y);
      case 'fire':
        return this.fire(pid, a.x, a.y);
      case 'execute':
        if (s.phase !== 'gameover' || s.winner !== pid || s.execution) return false;
        if (a.method !== 'plank' && a.method !== 'behead') return false;
        this.execute(a.method);
        return true;
    }
    return false;
  }

  private execute(method: 'plank' | 'behead') {
    this.s.execution = method;
    this.emit({ e: 'execute', method });
  }

  placePiece(pid: number, x: number, y: number, rot: number, seq: number): boolean {
    const s = this.s;
    const p = s.players[pid];
    if (s.phase !== 'build' || !p.alive || p.piece < 0 || seq !== p.pieceSeq) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    const cells = pieceCells(p.piece, rot | 0);
    const obs = obstacleMap(s);
    if (!canPlacePiece(s, pid, cells, x, y, obs)) return false;
    const placed: number[] = [];
    for (const [dx, dy] of cells) {
      const i = (y + dy) * s.W + x + dx;
      s.wall[i] = pid;
      s.rubble[i] = 0;
      this.markDirty(i);
      placed.push(i);
    }
    p.pieceSeq++;
    p.piece = p.next >= 0 ? p.next : this.randomPiece(pid);
    p.next = this.randomPiece(pid);
    p.cursorX = x;
    p.cursorY = y;
    p.rot = rot & 3;
    this.emit({ e: 'place', p: pid, cells: placed });
    this.updateTerritory();
    return true;
  }

  placeCannon(pid: number, x: number, y: number): boolean {
    const s = this.s;
    const p = s.players[pid];
    if (s.phase !== 'cannons' || !p.alive || p.cannonsToPlace <= 0) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    const obs = obstacleMap(s);
    if (!canPlaceCannon(s, pid, x, y, obs)) return false;
    s.cannons.push({ id: this.id(), owner: pid, x, y, hp: CANNON_HP, active: true, busy: false, angle: -Math.PI / 2 });
    this.cannonsChanged = true;
    p.cannonsToPlace--;
    p.cursorX = x;
    p.cursorY = y;
    this.emit({ e: 'cannon', p: pid, x, y });
    if (p.cannonsToPlace > 0 && !hasCannonSpot(s, pid, obstacleMap(s))) p.cannonsToPlace = 0;
    return true;
  }

  fire(pid: number, tx: number, ty: number): boolean {
    const s = this.s;
    const p = s.players[pid];
    if (s.phase !== 'combat' || !p.alive || s.time < s.fireStart || s.time >= s.fireEnd) return false;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
    tx = Math.max(0, Math.min(s.W - 0.01, tx));
    ty = Math.max(0, Math.min(s.H - 0.01, ty));
    let best = null;
    let bd = Infinity;
    for (const c of s.cannons) {
      if (c.owner !== pid || !c.active || c.busy) continue;
      const d = (c.x + 1 - tx) ** 2 + (c.y + 1 - ty) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) return false;
    best.busy = true;
    best.angle = Math.atan2(ty - (best.y + 1), tx - (best.x + 1));
    this.launch(pid, best.id, best.x + 1, best.y + 1, tx, ty);
    this.emit({ e: 'fire', p: pid, x: best.x + 1, y: best.y + 1 });
    return true;
  }

  private launch(owner: number, cannon: number, fx: number, fy: number, tx: number, ty: number) {
    const s = this.s;
    const dist = Math.hypot(tx - fx, ty - fy);
    const ball: Ball = { id: this.id(), owner, cannon, fx, fy, tx, ty, t0: s.time, dur: BALL_MIN_TIME + dist / BALL_SPEED };
    s.balls.push(ball);
    this.newBalls.push(ball);
  }

  // ------------------------------------------------------------ territory

  /** Recomputes enclosed territory, castle ownership and cannon activity for every living player. */
  updateTerritory() {
    const s = this.s;
    const N = s.W * s.H;
    const next = new Int8Array(N).fill(-1);
    const mask = new Uint8Array(N);
    for (const p of s.players) {
      if (!p.alive) continue;
      computeEnclosed(s.W, s.H, s.wall, p.id, mask);
      let count = 0;
      for (let i = 0; i < N; i++) {
        if (mask[i] && s.region[i] === p.id) {
          next[i] = p.id;
          count++;
        }
      }
      p.territory = count;
    }
    for (let i = 0; i < N; i++) {
      if (next[i] !== s.territory[i]) {
        s.territory[i] = next[i];
        this.markDirty(i);
      }
    }
    for (const p of s.players) p.castles = 0;
    for (const c of s.castles) {
      const i = c.y * s.W + c.x;
      const t = s.territory[i];
      const owner = t >= 0 && s.territory[i + 1] === t && s.territory[i + s.W] === t && s.territory[i + s.W + 1] === t ? t : -1;
      if (owner !== c.owner) {
        c.owner = owner;
        this.castlesChanged = true;
        if (owner >= 0) this.emit({ e: 'castle', p: owner, id: c.id });
      }
      if (owner >= 0) s.players[owner].castles++;
    }
    for (const c of s.cannons) {
      const i = c.y * s.W + c.x;
      const active =
        s.territory[i] === c.owner &&
        s.territory[i + 1] === c.owner &&
        s.territory[i + s.W] === c.owner &&
        s.territory[i + s.W + 1] === c.owner &&
        s.players[c.owner].alive;
      if (active !== c.active) {
        c.active = active;
        this.cannonsChanged = true;
      }
    }
  }

  /** Wall ring around a castle, preferring two tiles of space on every side. */
  homeRing(castleId: number): { tiles: number[]; complete: boolean } {
    const s = this.s;
    const c = s.castles[castleId];
    const obs = obstacleMap(s);
    const pid = c.region;
    let best: number[] | null = null;
    let bestScore = -Infinity;
    for (let l = 1; l <= 3; l++)
      for (let r = 1; r <= 3; r++)
        for (let t = 1; t <= 3; t++)
          for (let b = 1; b <= 3; b++) {
            const x0 = c.x - l - 1;
            const x1 = c.x + 1 + r + 1;
            const y0 = c.y - t - 1;
            const y1 = c.y + 1 + b + 1;
            if (x0 < 0 || y0 < 0 || x1 >= s.W || y1 >= s.H) continue;
            const score = -(Math.abs(l - 2) + Math.abs(r - 2) + Math.abs(t - 2) + Math.abs(b - 2)) * 2 - (l + r + t + b) * 0.1;
            if (score <= bestScore) continue;
            let ok = true;
            const tiles: number[] = [];
            for (let y = y0; y <= y1 && ok; y++) {
              for (let x = x0; x <= x1; x++) {
                const i = y * s.W + x;
                const edge = x === x0 || x === x1 || y === y0 || y === y1;
                if (edge) {
                  if (s.wall[i] === pid) continue;
                  if (!buildable(s, pid, i, obs)) {
                    ok = false;
                    break;
                  }
                  tiles.push(i);
                } else if (s.region[i] !== pid) {
                  ok = false;
                  break;
                }
              }
            }
            if (ok) {
              best = tiles;
              bestScore = score;
            }
          }
    if (best) {
      // Order tiles clockwise around the castle so the wall "grows" around it.
      const cx = c.x + 1;
      const cy = c.y + 1;
      best.sort((a, b) => {
        const aa = Math.atan2((a - (a % s.W)) / s.W + 0.5 - cy, (a % s.W) + 0.5 - cx);
        const bb = Math.atan2((b - (b % s.W)) / s.W + 0.5 - cy, (b % s.W) + 0.5 - cx);
        return aa - bb;
      });
      return { tiles: best, complete: true };
    }
    // Fallback: whatever of the tight ring can be built.
    const tiles: number[] = [];
    for (let y = c.y - 2; y <= c.y + 3; y++)
      for (let x = c.x - 2; x <= c.x + 3; x++) {
        if (x < 0 || y < 0 || x >= s.W || y >= s.H) continue;
        const edge = x === c.x - 2 || x === c.x + 3 || y === c.y - 2 || y === c.y + 3;
        const i = y * s.W + x;
        if (edge && buildable(s, pid, i, obs)) tiles.push(i);
      }
    return { tiles, complete: false };
  }

  // ---------------------------------------------------------------- phases

  private startAutobuild() {
    const s = this.s;
    this.autobuild = s.players.map((p) => (p.alive && p.home >= 0 ? this.homeRing(p.home).tiles : []));
    this.setPhase('autobuild', AUTOBUILD_TIME);
  }

  private tickAutobuild() {
    const s = this.s;
    const f = Math.min(1, (s.time - s.phaseStart) / (AUTOBUILD_TIME - 0.6));
    s.players.forEach((p, pid) => {
      const tiles = this.autobuild[pid] ?? [];
      const want = Math.ceil(f * tiles.length);
      let changed = false;
      for (let k = 0; k < want; k++) {
        const i = tiles[k];
        if (s.wall[i] !== pid) {
          s.wall[i] = pid;
          this.markDirty(i);
          changed = true;
        }
      }
      if (changed && want === tiles.length) this.emit({ e: 'place', p: pid, cells: [] });
    });
    if (s.time >= s.phaseEnd) {
      this.updateTerritory();
      this.startCannons(true);
    }
  }

  private startCannons(first: boolean) {
    const s = this.s;
    const obs = obstacleMap(s);
    for (const p of s.players) {
      p.cannonsToPlace = p.alive ? cannonAllowance(s, p.id) : 0;
      if (first && p.alive) p.cannonsToPlace = Math.max(p.cannonsToPlace, 3);
      if (p.cannonsToPlace > 0 && !hasCannonSpot(s, p.id, obs)) p.cannonsToPlace = 0;
    }
    this.setPhase('cannons', first ? FIRST_CANNON_TIME : CANNON_TIME);
  }

  private startCombat() {
    const s = this.s;
    for (const p of s.players) p.cannonsToPlace = 0;
    for (const c of s.cannons) c.busy = false;
    const fight = s.mode === 'solo' ? SOLO_COMBAT_TIME : COMBAT_TIME;
    s.fireStart = s.time + COMBAT_READY;
    s.fireEnd = s.fireStart + fight;
    if (s.solo) {
      if (s.solo.levelDone) this.setupLevel(s.solo.level + 1);
      s.solo.spawnT = s.time;
      this.buildSeaFields();
      const def = LEVELS[s.solo.level - 1];
      for (const sh of s.ships) sh.reload = def.fireInterval * this.rng.range(0.4, 1.0) + COMBAT_READY;
    }
    this.setPhase('combat', COMBAT_READY + fight);
  }

  private tickCombat(dt: number) {
    const s = this.s;
    const firing = s.time >= s.fireStart && s.time < s.fireEnd;
    if (s.solo) {
      this.updateShips(dt, firing);
      if (firing) this.updateGrunts(dt);
      const solo = s.solo;
      const def = LEVELS[solo.level - 1];
      const afloat = s.ships.filter((sh) => sh.sinkT === 0).length;
      if (!solo.levelDone && solo.remaining > 0 && afloat < def.maxAtSea && s.time >= solo.spawnT && s.time < s.fireEnd - 3) {
        this.spawnShip();
        solo.spawnT = s.time + this.rng.range(1.2, 3.2);
      }
      if (!solo.levelDone && solo.remaining === 0 && afloat === 0 && s.time >= s.fireStart) {
        solo.levelDone = true;
        const bonus = SCORE_LEVEL * solo.level;
        this.addScore(0, bonus, s.W / 2, s.H / 2);
        this.emit({ e: 'levelComplete', level: solo.level, bonus });
        if (s.fireEnd > s.time + 1) s.fireEnd = s.time + 1;
        s.phaseEnd = s.fireEnd;
      }
    }
    if (s.time >= s.fireEnd && (s.balls.length === 0 || s.time >= s.fireEnd + CEASEFIRE_MAX)) {
      s.balls.length = 0;
      for (const c of s.cannons) c.busy = false;
      this.endCombat();
    }
  }

  private endCombat() {
    const s = this.s;
    s.ships = s.ships.filter((sh) => sh.sinkT === 0);
    this.updateTerritory();
    if (s.solo && s.solo.levelDone && s.solo.level >= SOLO_LEVELS) {
      s.solo.victory = true;
      this.gameOver(0);
      return;
    }
    this.startBuild();
  }

  private startBuild() {
    const s = this.s;
    for (const p of s.players) {
      if (!p.alive) continue;
      if (p.next < 0) p.next = this.randomPiece(p.id);
      if (p.piece < 0) {
        p.piece = p.next;
        p.next = this.randomPiece(p.id);
      }
      const home = s.castles[p.home];
      if (home && (p.cursorX < 0 || p.cursorY < 0)) {
        p.cursorX = home.x;
        p.cursorY = home.y - 3;
      }
    }
    this.setPhase('build', BUILD_TIME);
  }

  private endBuild() {
    const s = this.s;
    for (const p of s.players) p.piece = -1;
    this.updateTerritory();

    // Grunts caught inside a player's walls are crushed.
    s.grunts = s.grunts.filter((g) => {
      const t = s.territory[g.y * s.W + g.x];
      if (t >= 0) {
        this.addScore(t, SCORE_GRUNT, g.x + 0.5, g.y + 0.5);
        this.emit({ e: 'boom', x: g.x + 0.5, y: g.y + 0.5, kind: 'grunt' });
        return false;
      }
      return true;
    });

    const rows: SummaryRow[] = [];
    for (const p of s.players) {
      if (!p.alive) continue;
      let castles = 0;
      for (const c of s.castles) if (c.owner === p.id) castles += c.id === p.home ? SCORE_HOME : SCORE_CASTLE;
      let bonus = 0;
      let dirtyTiles = 0;
      for (let i = 0; i < s.W * s.H; i++) {
        if (s.territory[i] !== p.id) continue;
        if (s.bonus[i]) bonus += SCORE_BONUS_SQUARE;
        if (s.crater[i]) dirtyTiles++;
      }
      for (const g of s.grunts) if (s.territory[g.y * s.W + g.x] === p.id) dirtyTiles++;
      const territory = p.territory * SCORE_TILE;
      const clean = p.territory > 0 && dirtyTiles === 0 ? SCORE_CLEAN : 0;
      const total = castles + territory + bonus + clean;
      p.score += total;
      rows.push({ p: p.id, castles, territory, bonus, clean, total });
    }
    s.summary = rows;

    for (let i = 0; i < s.W * s.H; i++) {
      if (s.crater[i] > 0) {
        s.crater[i]--;
        this.markDirty(i);
      }
    }

    for (const p of s.players) {
      if (p.alive && p.castles === 0) {
        p.alive = false;
        p.outRound = s.round;
        p.piece = -1;
        this.emit({ e: 'eliminated', p: p.id });
      }
    }
    if (s.players.some((p) => !p.alive)) this.updateTerritory();

    if (s.mode === 'solo') {
      if (!s.players[0].alive) return this.gameOver(-1);
    } else {
      const alive = this.alivePlayers();
      if (alive.length <= 1 || s.round >= s.maxRounds) {
        const pool = alive.length ? alive : s.players.filter((p) => p.outRound === s.round);
        const winner = pool.reduce((a, b) => (b.score > a.score ? b : a), pool[0]);
        return this.gameOver(winner ? winner.id : -1);
      }
    }
    this.setPhase('summary', SUMMARY_TIME);
  }

  private gameOver(winner: number) {
    const s = this.s;
    s.winner = winner;
    s.balls.length = 0;
    this.setPhase('gameover', 25);
    this.emit({ e: 'gameover', winner });
  }

  // ----------------------------------------------------------------- balls

  private updateBalls() {
    const s = this.s;
    if (!s.balls.length) return;
    const landed: Ball[] = [];
    s.balls = s.balls.filter((b) => {
      if (s.time >= b.t0 + b.dur) {
        landed.push(b);
        return false;
      }
      return true;
    });
    for (const b of landed) {
      const c = s.cannons.find((cn) => cn.id === b.cannon);
      if (c) c.busy = false;
      this.impact(b);
    }
  }

  private boom(x: number, y: number, kind: BoomKind) {
    this.emit({ e: 'boom', x, y, kind });
  }

  private impact(b: Ball) {
    const s = this.s;
    const { tx: x, ty: y, owner } = b;
    if (owner >= 0) {
      for (const sh of s.ships) {
        if (sh.sinkT > 0) continue;
        if (Math.hypot(sh.x - x, sh.y - y) < SHIP_RADIUS[sh.kind]) {
          sh.hp--;
          this.boom(x, y, 'ship');
          if (sh.hp <= 0) {
            sh.sinkT = s.time;
            this.addScore(owner, SCORE_SHIP[sh.kind], sh.x, sh.y);
            this.emit({ e: 'sink', x: sh.x, y: sh.y });
            if (s.solo) s.solo.sunk++;
          }
          return;
        }
      }
    }
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= s.W || iy >= s.H) return;
    const i = iy * s.W + ix;
    const gi = s.grunts.findIndex((g) => g.x === ix && g.y === iy);
    if (gi >= 0) {
      s.grunts.splice(gi, 1);
      if (owner >= 0) this.addScore(owner, SCORE_GRUNT, x, y);
      this.boom(x, y, 'grunt');
      return;
    }
    if (s.terrain[i] !== LAND) {
      this.boom(x, y, 'water');
      return;
    }
    if (owner >= 0 && s.region[i] === owner) {
      this.boom(x, y, 'dud');
      return;
    }
    if (s.wall[i] >= 0 && s.wall[i] !== owner) {
      s.wall[i] = -1;
      s.rubble[i] = 1;
      this.markDirty(i);
      if (owner >= 0) this.addScore(owner, SCORE_WALL, x, y);
      this.boom(x, y, 'wall');
      return;
    }
    const cn = cannonAt(s, ix, iy);
    if (cn && cn.owner !== owner) {
      cn.hp--;
      this.cannonsChanged = true;
      this.boom(x, y, 'cannon');
      if (cn.hp <= 0) {
        s.cannons = s.cannons.filter((c) => c !== cn);
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const k = (cn.y + dy) * s.W + cn.x + dx;
            s.crater[k] = CRATER_ROUNDS;
            s.rubble[k] = 1;
            this.markDirty(k);
          }
        if (owner >= 0) this.addScore(owner, SCORE_CANNON_KILL, x, y);
      } else if (owner >= 0) {
        this.addScore(owner, SCORE_CANNON_HIT, x, y);
      }
      return;
    }
    if (castleAt(s, ix, iy)) {
      this.boom(x, y, 'castle');
      return;
    }
    s.crater[i] = CRATER_ROUNDS;
    this.markDirty(i);
    this.boom(x, y, 'ground');
  }

  // ------------------------------------------------------- solo: the fleet

  private setupLevel(level: number) {
    const solo = this.s.solo!;
    const def = LEVELS[Math.min(level, LEVELS.length) - 1];
    solo.level = level;
    solo.total = def.total;
    solo.remaining = def.total;
    solo.sunk = 0;
    solo.levelDone = false;
    this.emit({ e: 'level', level });
  }

  private computeLandDist(): Int16Array {
    const s = this.s;
    const N = s.W * s.H;
    const dist = new Int16Array(N).fill(FAR);
    const q: number[] = [];
    for (let i = 0; i < N; i++) {
      if (s.terrain[i] === LAND) {
        dist[i] = 0;
        q.push(i);
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % s.W;
      const y = (i - x) / s.W;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
        const n = ny * s.W + nx;
        if (dist[n] > dist[i] + 1) {
          dist[n] = dist[i] + 1;
          q.push(n);
        }
      }
    }
    return dist;
  }

  /** Flow fields over open water that lead ships into firing (or landing) positions. */
  private buildSeaFields() {
    const s = this.s;
    const N = s.W * s.H;
    const walls: number[] = [];
    for (let i = 0; i < N; i++) if (s.wall[i] === 0) walls.push(i);
    const nearWalls = (i: number) => {
      if (!walls.length) return true;
      const x = i % s.W;
      const y = (i - x) / s.W;
      for (const w of walls) {
        const wx = w % s.W;
        const wy = (w - wx) / s.W;
        if ((wx - x) ** 2 + (wy - y) ** 2 <= (SHIP_RANGE - 3) ** 2) return true;
      }
      return false;
    };
    let near: number[] = [];
    const shore: number[] = [];
    for (let i = 0; i < N; i++) {
      if (s.terrain[i] === LAND) continue;
      const d = this.landDist[i];
      if (d >= 2 && d <= 4 && nearWalls(i)) near.push(i);
      if (d === 1) shore.push(i);
    }
    if (!near.length) {
      for (let i = 0; i < N; i++) if (s.terrain[i] !== LAND && this.landDist[i] >= 2 && this.landDist[i] <= 4) near.push(i);
    }
    this.seaNear = this.seaField(near);
    this.seaShore = this.seaField(shore);
  }

  private seaField(goals: number[]): Int16Array {
    const s = this.s;
    const f = new Int16Array(s.W * s.H).fill(FAR);
    const q: number[] = [];
    for (const g of goals) {
      f[g] = 0;
      q.push(g);
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % s.W;
      const y = (i - x) / s.W;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.seaPassable(x, y, nx, ny)) continue;
        const n = ny * s.W + nx;
        if (f[n] > f[i] + 1) {
          f[n] = f[i] + 1;
          q.push(n);
        }
      }
    }
    return f;
  }

  private seaLineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    const s = this.s;
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (const [ox, oy] of [[0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]]) {
        const tx = Math.floor(x + ox);
        const ty = Math.floor(y + oy);
        if (tx < 0 || ty < 0 || tx >= s.W || ty >= s.H || s.terrain[ty * s.W + tx] === LAND) return false;
      }
    }
    return true;
  }

  private seaPassable(x: number, y: number, nx: number, ny: number): boolean {
    const s = this.s;
    if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) return false;
    if (s.terrain[ny * s.W + nx] === LAND) return false;
    if (nx !== x && ny !== y) {
      if (s.terrain[y * s.W + nx] === LAND || s.terrain[ny * s.W + x] === LAND) return false;
    }
    return true;
  }

  private spawnShip() {
    const s = this.s;
    const solo = s.solo!;
    const def = LEVELS[solo.level - 1];
    const edge: number[] = [];
    for (let y = 1; y < s.H - 1; y++) if (s.terrain[y * s.W + s.W - 1] !== LAND) edge.push(y);
    if (!edge.length) return;
    const taken = new Set(s.ships.map((sh) => Math.floor(sh.y)));
    const free = edge.filter((y) => !taken.has(y));
    const y = this.rng.pick(free.length ? free : edge);
    const kind = this.rng.weighted(def.kinds);
    const ship: Ship = {
      id: this.id(),
      kind,
      x: s.W + 1,
      y: y + 0.5,
      vx: 0,
      vy: 0,
      angle: Math.PI,
      hp: SHIP_HP[kind],
      sinkT: 0,
      reload: def.fireInterval * this.rng.range(0.6, 1.2),
      wx: s.W - 0.5,
      wy: y + 0.5,
      grunts: kind === 2 && this.rng.next() < def.gruntChance ? 2 : kind === 1 && this.rng.next() < def.gruntChance / 3 ? 1 : 0,
      dropT: 0,
      holdT: 0,
      patrol: false,
    };
    s.ships.push(ship);
    solo.remaining--;
  }

  private updateShips(dt: number, firing: boolean) {
    const s = this.s;
    const def = LEVELS[s.solo!.level - 1];
    s.ships = s.ships.filter((sh) => sh.sinkT === 0 || s.time - sh.sinkT < 1.6);
    const occupied = new Set<number>();
    for (const sh of s.ships) {
      if (sh.sinkT > 0) continue;
      occupied.add(Math.floor(sh.wy) * s.W + Math.floor(sh.wx));
    }
    for (const sh of s.ships) {
      if (sh.sinkT > 0) {
        sh.vx = sh.vy = 0;
        continue;
      }
      const speed = SHIP_SPEED[sh.kind] * def.speed * (sh.patrol ? 0.6 : 1);
      const dx = sh.wx - sh.x;
      const dy = sh.wy - sh.y;
      const d = Math.hypot(dx, dy);
      if (s.time < sh.holdT) {
        sh.vx = sh.vy = 0;
      } else if (d < 0.05) {
        sh.x = sh.wx;
        sh.y = sh.wy;
        if (sh.patrol) {
          // End of a patrol leg: drop anchor for a moment and let the gunners work.
          sh.patrol = false;
          sh.holdT = s.time + this.rng.range(1.2, 2.8);
        } else {
          this.chooseWaypoint(sh, occupied);
        }
        sh.vx = sh.vy = 0;
      } else {
        const step = Math.min(d, speed * dt);
        sh.vx = (dx / d) * speed;
        sh.vy = (dy / d) * speed;
        sh.x += (dx / d) * step;
        sh.y += (dy / d) * step;
        const target = Math.atan2(dy, dx);
        let da = target - sh.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        sh.angle += Math.max(-4 * dt, Math.min(4 * dt, da));
      }

      if (sh.grunts > 0 && s.time >= sh.dropT) this.tryDropGrunt(sh);

      if (!firing) continue;
      sh.reload -= dt;
      if (sh.reload <= 0) {
        const target = this.shipTarget(sh);
        if (target) {
          const err = def.aim;
          this.launch(-1, -1, sh.x, sh.y, target.x + this.rng.gauss() * err, target.y + this.rng.gauss() * err);
          this.emit({ e: 'fire', p: -1, x: sh.x, y: sh.y });
          sh.reload = def.fireInterval * this.rng.range(0.7, 1.3);
        } else {
          sh.reload = 0.6;
        }
      }
    }
  }

  private chooseWaypoint(sh: Ship, occupied: Set<number>) {
    const s = this.s;
    const cx = Math.floor(sh.x);
    const cy = Math.floor(sh.y);
    occupied.delete(cy * s.W + cx);
    if (cx < 0 || cy < 0 || cx >= s.W || cy >= s.H) {
      sh.wx = Math.max(0, Math.min(s.W - 1, cx)) + 0.5;
      sh.wy = Math.max(0, Math.min(s.H - 1, cy)) + 0.5;
      occupied.add(Math.floor(sh.wy) * s.W + Math.floor(sh.wx));
      return;
    }
    const field = sh.grunts > 0 ? this.seaShore : this.seaNear;
    if (!field) return;
    const here = field[cy * s.W + cx];
    const opts: { x: number; y: number; v: number }[] = [];
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!this.seaPassable(cx, cy, nx, ny)) continue;
      const n = ny * s.W + nx;
      if (occupied.has(n)) continue;
      opts.push({ x: nx, y: ny, v: field[n] });
    }
    let choice: { x: number; y: number } | null = null;
    if (here > 0) {
      const min = Math.min(...opts.map((o) => o.v), FAR);
      const best = opts.filter((o) => o.v === min && o.v < here);
      if (best.length) choice = this.rng.pick(best);
    } else {
      // Sail a straight leg along the firing line so gunners can lead the ship.
      const legs: { x: number; y: number }[] = [];
      for (let y = cy - 6; y <= cy + 6; y++) {
        for (let x = cx - 6; x <= cx + 6; x++) {
          if (x < 0 || y < 0 || x >= s.W || y >= s.H) continue;
          const n = y * s.W + x;
          const len = Math.hypot(x - cx, y - cy);
          if (field[n] !== 0 || len < 2.5 || len > 6.5 || occupied.has(n)) continue;
          if (this.seaLineClear(cx + 0.5, cy + 0.5, x + 0.5, y + 0.5)) legs.push({ x, y });
        }
      }
      if (legs.length) {
        choice = this.rng.pick(legs);
        sh.patrol = true;
      } else {
        sh.holdT = s.time + 1;
      }
    }
    if (choice) {
      sh.wx = choice.x + 0.5;
      sh.wy = choice.y + 0.5;
    } else {
      sh.wx = cx + 0.5 + this.rng.range(-0.2, 0.2);
      sh.wy = cy + 0.5 + this.rng.range(-0.2, 0.2);
    }
    occupied.add(Math.floor(sh.wy) * s.W + Math.floor(sh.wx));
  }

  private shipTarget(sh: Ship): { x: number; y: number } | null {
    const s = this.s;
    const r2 = SHIP_RANGE * SHIP_RANGE;
    if (this.rng.next() < 0.18) {
      const cannons = s.cannons.filter((c) => (c.x + 1 - sh.x) ** 2 + (c.y + 1 - sh.y) ** 2 < r2);
      if (cannons.length) {
        const c = this.rng.pick(cannons);
        return { x: c.x + 0.5 + this.rng.int(2), y: c.y + 0.5 + this.rng.int(2) };
      }
    }
    const cands: { i: number; d: number }[] = [];
    for (let i = 0; i < s.W * s.H; i++) {
      if (s.wall[i] < 0) continue;
      const x = i % s.W;
      const y = (i - x) / s.W;
      const d = (x + 0.5 - sh.x) ** 2 + (y + 0.5 - sh.y) ** 2;
      if (d > r2) continue;
      const ring = DIRS4.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < s.W && ny < s.H && s.territory[ny * s.W + nx] >= 0;
      });
      cands.push({ i, d: d - (ring ? 40 : 0) });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const pick = cands[this.rng.int(Math.min(10, cands.length))].i;
    return { x: (pick % s.W) + 0.5, y: Math.floor(pick / s.W) + 0.5 };
  }

  private tryDropGrunt(sh: Ship) {
    const s = this.s;
    if (s.grunts.length >= MAX_GRUNTS) return;
    const cx = Math.floor(sh.x);
    const cy = Math.floor(sh.y);
    if (cx < 0 || cy < 0 || cx >= s.W || cy >= s.H || this.landDist[cy * s.W + cx] !== 1) return;
    const obs = obstacleMap(s);
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
      const n = ny * s.W + nx;
      if (s.terrain[n] === LAND && s.wall[n] < 0 && !obs[n] && s.territory[n] < 0) {
        s.grunts.push({ id: this.id(), x: nx, y: ny, moveT: GRUNT_MOVE_TIME, attackT: 0 });
        sh.grunts--;
        sh.dropT = s.time + 2.5;
        this.emit({ e: 'grunt', x: nx + 0.5, y: ny + 0.5 });
        return;
      }
    }
    sh.dropT = s.time + 0.5;
  }

  private updateGrunts(dt: number) {
    const s = this.s;
    if (!s.grunts.length) return;
    const N = s.W * s.H;
    const obs = obstacleMap(s);
    // BFS from tiles next to walls, across open land.
    const field = new Int16Array(N).fill(FAR);
    const q: number[] = [];
    const walkable = (i: number) => s.terrain[i] === LAND && s.wall[i] < 0 && obs[i] !== OBS_CASTLE && obs[i] !== OBS_CANNON;
    const wallAt = (x: number, y: number) => x >= 0 && y >= 0 && x < s.W && y < s.H && s.wall[y * s.W + x] >= 0;
    for (let i = 0; i < N; i++) {
      if (!walkable(i)) continue;
      const x = i % s.W;
      const y = (i - x) / s.W;
      if (DIRS4.some(([dx, dy]) => wallAt(x + dx, y + dy))) {
        field[i] = 0;
        q.push(i);
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % s.W;
      const y = (i - x) / s.W;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
        const n = ny * s.W + nx;
        if (walkable(n) && field[n] > field[i] + 1) {
          field[n] = field[i] + 1;
          q.push(n);
        }
      }
    }
    for (const g of s.grunts) {
      g.moveT -= dt;
      if (g.moveT > 0) continue;
      g.moveT = GRUNT_MOVE_TIME * this.rng.range(0.8, 1.2);
      const i = g.y * s.W + g.x;
      if (field[i] === 0) {
        g.attackT += GRUNT_MOVE_TIME;
        if (g.attackT >= GRUNT_ATTACK_TIME) {
          g.attackT = 0;
          for (const [dx, dy] of this.rng.shuffle([...DIRS4])) {
            const nx = g.x + dx;
            const ny = g.y + dy;
            if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
            const n = ny * s.W + nx;
            if (s.wall[n] >= 0) {
              s.wall[n] = -1;
              s.rubble[n] = 1;
              this.markDirty(n);
              this.boom(nx + 0.5, ny + 0.5, 'wall');
              break;
            }
          }
        }
        continue;
      }
      let best = -1;
      let bv = field[i];
      for (const [dx, dy] of this.rng.shuffle([...DIRS4])) {
        const nx = g.x + dx;
        const ny = g.y + dy;
        if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
        const n = ny * s.W + nx;
        if (field[n] < bv && !s.grunts.some((o) => o !== g && o.x === nx && o.y === ny)) {
          bv = field[n];
          best = n;
        }
      }
      if (best >= 0) {
        g.x = best % s.W;
        g.y = (best - g.x) / s.W;
      }
    }
  }
}

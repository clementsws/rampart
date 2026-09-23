import { flightTime } from './constants';
import type { Game } from './engine';
import { DIRS4 } from './mapgen';
import { UNIQUE_ROTATIONS, pieceCells } from './pieces';
import { Rng } from './rng';
import { buildable, canPlaceCannon, canPlacePiece, computeEnclosed, obstacleMap, regionBounds } from './rules';
import { Difficulty, LAND, Phase } from './types';

interface Skill {
  /** Cursor speed in tiles per second. */
  move: number;
  /** Pause before committing a piece. */
  think: number;
  cannonDelay: number;
  fireDelay: number;
  /** Aim error (std-dev, tiles). */
  aim: number;
  /** Chance of taking a merely-good move instead of the best. */
  sloppy: number;
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { move: 9, think: 0.75, cannonDelay: 1.1, fireDelay: 1.15, aim: 0.75, sloppy: 0.35 },
  normal: { move: 15, think: 0.4, cannonDelay: 0.7, fireDelay: 0.65, aim: 0.42, sloppy: 0.12 },
  hard: { move: 24, think: 0.18, cannonDelay: 0.4, fireDelay: 0.38, aim: 0.22, sloppy: 0 },
};

/** Desired territory: a rectangle of interior tiles plus the ring of wall tiles around it. */
interface Plan {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  missing: Uint8Array;
  interior: Uint8Array;
  ringDist: Int16Array;
  missingCount: number;
}

interface Target {
  x: number;
  y: number;
  rot: number;
  seq: number;
  readyAt: number;
  fromX: number;
  fromY: number;
  startT: number;
  arriveT: number;
}

export class AIController {
  private rng: Rng;
  private target: Target | null = null;
  private actT = 0;
  private focus = -1;
  private stuckUntil = 0;
  private lastPlan: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private fillCost: Uint8Array | null = null;
  private fillT = 0;

  constructor(
    private readonly g: Game,
    readonly pid: number,
  ) {
    this.rng = new Rng(g.s.seed * 31 + pid * 977 + 13);
  }

  private get skill(): Skill {
    return SKILL[this.g.s.players[this.pid].difficulty] ?? SKILL.normal;
  }

  onPhase(phase: Phase) {
    this.target = null;
    this.focus = -1;
    this.stuckUntil = 0;
    this.actT = this.g.s.time + 0.4 + this.rng.next() * 0.8;
    this.fillT = this.actT + this.skill.think;
    const p = this.g.s.players[this.pid];
    const home = this.g.s.castles[p.home];
    if ((phase === 'build' || phase === 'cannons') && home) {
      // The cursor may still point at the last firing target in a rival's land.
      p.cursorX = home.x;
      p.cursorY = home.y;
    }
  }

  tick() {
    const s = this.g.s;
    const p = s.players[this.pid];
    if (!p.alive || s.time < this.actT) return;
    switch (s.phase) {
      case 'select':
        if (p.home < 0) {
          const c = this.g.defaultCastle(this.pid);
          if (c) this.g.act(this.pid, { type: 'select', castle: c.id });
        }
        break;
      case 'build':
        this.buildTick();
        break;
      case 'cannons':
        this.cannonTick();
        break;
      case 'combat':
        this.combatTick();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ build

  private buildTick() {
    const s = this.g.s;
    const p = s.players[this.pid];
    if (p.piece < 0 || s.time < this.stuckUntil) return;
    if (!this.target || this.target.seq !== p.pieceSeq) {
      if (this.fillTick()) return;
      const choice = this.choosePlacement();
      if (!choice) {
        this.stuckUntil = s.time + 1;
        return;
      }
      const fromX = p.cursorX >= 0 ? p.cursorX : choice.x;
      const fromY = p.cursorY >= 0 ? p.cursorY : choice.y;
      const dist = Math.hypot(choice.x - fromX, choice.y - fromY);
      const travel = dist / this.skill.move;
      this.target = {
        ...choice,
        seq: p.pieceSeq,
        fromX,
        fromY,
        startT: s.time,
        arriveT: s.time + travel,
        readyAt: s.time + travel + this.skill.think * (0.6 + this.rng.next() * 0.8),
      };
    }
    const t = this.target;
    const k = t.arriveT > t.startT ? Math.min(1, (s.time - t.startT) / (t.arriveT - t.startT)) : 1;
    p.cursorX = Math.round(t.fromX + (t.x - t.fromX) * k);
    p.cursorY = Math.round(t.fromY + (t.y - t.fromY) * k);
    if (k > 0.5) p.rot = t.rot;
    if (s.time >= t.readyAt) {
      const ok = this.g.act(this.pid, { type: 'place', x: t.x, y: t.y, rot: t.rot, seq: p.pieceSeq });
      this.target = null;
      if (!ok) this.stuckUntil = s.time + 0.3;
    }
  }

  /** Shovels a crater that is in the way of the planned walls (or spoils the land inside). */
  private fillTick(): boolean {
    const s = this.g.s;
    const p = s.players[this.pid];
    if (p.fills <= 0 || s.time < this.fillT) return false;
    // Easier computers forget about their shovels now and then.
    if (this.rng.next() < this.skill.sloppy) {
      this.fillT = s.time + 3;
      return false;
    }
    const i = this.chooseFill();
    if (i < 0) {
      this.fillT = s.time + 2;
      return false;
    }
    const x = i % s.W;
    const y = (i - x) / s.W;
    this.g.act(this.pid, { type: 'fill', x, y });
    p.cursorX = x;
    p.cursorY = y;
    this.fillT = s.time + this.skill.think + 0.3;
    this.stuckUntil = s.time + this.skill.think * 0.6;
    return true;
  }

  private chooseFill(): number {
    const g = this.g;
    const s = g.s;
    if (!this.lastPlan) this.computePlan();
    const r = this.lastPlan;
    if (!r) return -1;
    let best = -1;
    let bv = 0;
    for (let y = Math.max(0, r.y0 - 2); y <= Math.min(s.H - 1, r.y1 + 2); y++) {
      for (let x = Math.max(0, r.x0 - 2); x <= Math.min(s.W - 1, r.x1 + 2); x++) {
        const i = y * s.W + x;
        if (!g.canFill(this.pid, i)) continue;
        const inside = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        const ring = !inside && x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1;
        // Craters on the wall line matter most, then ones that spoil the enclosed land.
        const v = (ring ? 10 : inside ? 4 : 2) + this.rng.next();
        if (v > bv) {
          bv = v;
          best = i;
        }
      }
    }
    return best;
  }

  /**
   * Picks the most valuable rectangle of land to hold (its interior is the "core"),
   * then finds the fewest wall tiles that seal that core off from the outside.
   */
  computePlan(): Plan | null {
    const g = this.g;
    const s = g.s;
    const pid = this.pid;
    const W = s.W;
    const H = s.H;
    const N = W * H;
    const obs = obstacleMap(s);
    const b = regionBounds(s, pid);
    const home = s.castles[s.players[pid].home];

    // Per tile: 0 = own wall, 1 = buildable now, 2 = blocked for now (crater, cannon...), 3 = never (water, foreign).
    const kind = new Uint8Array(N);
    const inReg = new Uint8Array(N);
    const free = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      inReg[i] = s.region[i] === pid && s.terrain[i] === LAND ? 1 : 0;
      if (s.wall[i] === pid) kind[i] = 0;
      else if (buildable(s, pid, i, obs)) kind[i] = 1;
      else kind[i] = inReg[i] ? 2 : 3;
      free[i] = inReg[i] && s.wall[i] < 0 && !s.crater[i] && !obs[i] ? 1 : 0;
    }
    // Gaps boxed in by craters or walls only accept tiny pieces, so they are "expensive" to fill.
    const cost = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (kind[i] !== 1) continue;
      const x = i % W;
      let nb = 0;
      if (x > 0 && kind[i - 1] === 1) nb++;
      if (x < W - 1 && kind[i + 1] === 1) nb++;
      if (i >= W && kind[i - W] === 1) nb++;
      if (i < N - W && kind[i + W] === 1) nb++;
      cost[i] = nb >= 2 ? 1 : nb === 1 ? 3 : 10;
    }
    // Row-wise and column-wise prefix sums for O(1) ring evaluation.
    const rowHard = new Int32Array((W + 1) * H);
    const rowSoft = new Int32Array((W + 1) * H);
    const rowMiss = new Int32Array((W + 1) * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = y * (W + 1) + x;
        rowHard[o + 1] = rowHard[o] + (kind[i] === 3 ? 1 : 0);
        rowSoft[o + 1] = rowSoft[o] + (kind[i] === 2 ? 1 : 0);
        rowMiss[o + 1] = rowMiss[o] + (kind[i] === 1 ? 1 : 0);
      }
    }
    const colHard = new Int32Array((H + 1) * W);
    const colSoft = new Int32Array((H + 1) * W);
    const colMiss = new Int32Array((H + 1) * W);
    const colReg = new Int32Array((H + 1) * W);
    const colFree = new Int32Array((H + 1) * W);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const i = y * W + x;
        const o = x * (H + 1) + y;
        colHard[o + 1] = colHard[o] + (kind[i] === 3 ? 1 : 0);
        colSoft[o + 1] = colSoft[o] + (kind[i] === 2 ? 1 : 0);
        colMiss[o + 1] = colMiss[o] + (kind[i] === 1 ? 1 : 0);
        colReg[o + 1] = colReg[o] + inReg[i];
        colFree[o + 1] = colFree[o] + free[i];
      }
    }
    const rowSum = (arr: Int32Array, y: number, xa: number, xb: number) => arr[y * (W + 1) + xb + 1] - arr[y * (W + 1) + xa];
    const colSum = (arr: Int32Array, x: number, ya: number, yb: number) => arr[x * (H + 1) + yb + 1] - arr[x * (H + 1) + ya];

    const castles = s.castles.filter((c) => c.region === pid);
    const timeLeft = s.phase === 'build' ? Math.max(0, s.phaseEnd - s.time) : 20;
    const perPiece = this.skill.think + 0.35 + 6 / this.skill.move;
    // Conservative estimate of how many gaps can still be filled this phase.
    const capacity = (timeLeft / perPiece) * 1.3;
    // With no castle currently enclosed, survival comes first: close the cheapest ring.
    const urgent = s.players[pid].castles === 0;
    const prev = this.lastPlan;

    type Rect = { x0: number; y0: number; x1: number; y1: number; v: number; base: number };
    const perTile = urgent ? 60 : 22;
    const top: Rect[] = [];
    for (let y0 = b.y0 + 1; y0 <= b.y1 - 2; y0++) {
      for (let y1 = y0 + 1; y1 <= b.y1 - 1; y1++) {
        const h = y1 - y0 + 1;
        for (let x0 = b.x0 + 1; x0 <= b.x1 - 2; x0++) {
          if (colSum(colReg, x0, y0, y1) !== h || colSum(colHard, x0 - 1, y0, y1) !== 0) continue;
          let freeCount = 0;
          for (let x1 = x0; x1 <= b.x1 - 1; x1++) {
            if (colSum(colReg, x1, y0, y1) !== h) break;
            freeCount += colSum(colFree, x1, y0, y1);
            if (x1 === x0) continue;
            if (colSum(colHard, x1 + 1, y0, y1) !== 0) continue;
            if (rowSum(rowHard, y0 - 1, x0, x1) !== 0 || rowSum(rowHard, y1 + 1, x0, x1) !== 0) continue;
            let castleVal = 0;
            for (const c of castles) {
              if (c.x >= x0 && c.x + 1 <= x1 && c.y >= y0 && c.y + 1 <= y1) castleVal += c === home ? 1000 : 450;
            }
            if (!castleVal) continue;
            const soft =
              rowSum(rowSoft, y0 - 1, x0, x1) +
              rowSum(rowSoft, y1 + 1, x0, x1) +
              colSum(colSoft, x0 - 1, y0, y1) +
              colSum(colSoft, x1 + 1, y0, y1);
            const m =
              rowSum(rowMiss, y0 - 1, x0, x1) +
              rowSum(rowMiss, y1 + 1, x0, x1) +
              colSum(colMiss, x0 - 1, y0, y1) +
              colSum(colMiss, x1 + 1, y0, y1) +
              soft * 3;
            let base = urgent ? castleVal * 0.15 + Math.min(freeCount, 24) * 2 : castleVal + Math.min(freeCount, 90) * 3;
            if (prev && prev.x0 === x0 && prev.y0 === y0 && prev.x1 === x1 && prev.y1 === y1) base += 120;
            const v = base - m * perTile - Math.max(0, m - capacity) * (urgent ? 200 : 140);
            if (top.length < 6 || v > top[top.length - 1].v) {
              top.push({ x0, y0, x1, y1, v, base });
              top.sort((a, c) => c.v - a.v);
              if (top.length > 6) top.pop();
            }
          }
        }
      }
    }

    // Evaluate the shortlisted rectangles with their true sealing cost.
    let chosen: { r: Rect; cut: number[] } | null = null;
    let chosenV = -Infinity;
    for (const r of top) {
      const core = new Uint8Array(N);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) core[y * W + x] = 1;
      const cut = sealingCut(W, H, kind, cost, core);
      if (!cut) continue;
      let c = 0;
      for (const i of cut) c += cost[i];
      const v = r.base - c * perTile - Math.max(0, c - capacity) * (urgent ? 200 : 140);
      if (v > chosenV) {
        chosenV = v;
        chosen = { r, cut };
      }
    }
    if (chosen) {
      const { r, cut } = chosen;
      const missing = new Uint8Array(N);
      const walls = Int8Array.from(s.wall);
      for (const i of cut) {
        missing[i] = 1;
        walls[i] = pid;
      }
      const interior = new Uint8Array(N);
      computeEnclosed(W, H, walls, pid, interior);
      const ringDist = new Int16Array(N).fill(0x7fff);
      const q: number[] = [];
      for (let i = 0; i < N; i++) {
        if (walls[i] !== pid) continue;
        const x = i % W;
        const y = (i - x) / W;
        if (missing[i] || DIRS4.some(([dx, dy]) => x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && interior[(y + dy) * W + x + dx])) {
          ringDist[i] = 0;
          q.push(i);
        }
      }
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        const x = i % W;
        const y = (i - x) / W;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (ringDist[n] > ringDist[i] + 1) {
            ringDist[n] = ringDist[i] + 1;
            q.push(n);
          }
        }
      }
      this.lastPlan = r;
      this.fillCost = cost;
      return { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, missing, interior, ringDist, missingCount: cut.length };
    }
    this.lastPlan = null;
    return null;
  }

  private choosePlacement(): { x: number; y: number; rot: number } | null {
    const g = this.g;
    const s = g.s;
    const p = s.players[this.pid];
    const plan = this.computePlan();
    // Walls are complete: hold the piece rather than cluttering the land.
    if (plan && plan.missingCount === 0) return null;
    const obs = obstacleMap(s);
    const b = regionBounds(s, this.pid);
    const W = s.W;
    const nearMissing = new Uint8Array(W * s.H);
    if (plan) {
      for (let i = 0; i < W * s.H; i++) {
        if (!plan.missing[i]) continue;
        const x = i % W;
        const y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < s.H) nearMissing[ny * W + nx] = 1;
          }
      }
    }
    const opts: { x: number; y: number; rot: number; v: number }[] = [];
    for (const rot of UNIQUE_ROTATIONS[p.piece]) {
      const cells = pieceCells(p.piece, rot);
      for (let y = b.y0 - 1; y <= b.y1 + 1; y++) {
        for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
          if (!canPlacePiece(s, this.pid, cells, x, y, obs)) continue;
          let cover = 0;
          let inner = 0;
          let contact = 0;
          let far = 0;
          let crowd = 0;
          for (const [dx, dy] of cells) {
            const i = (y + dy) * W + x + dx;
            if (plan) {
              if (plan.missing[i]) cover += this.fillCost ? this.fillCost[i] : 1;
              else if (plan.interior[i]) inner++;
              else if (nearMissing[i]) crowd++;
              far += Math.min(plan.ringDist[i], 5);
            }
            for (const [ax, ay] of DIRS4) {
              const nx = x + dx + ax;
              const ny = y + dy + ay;
              if (nx >= 0 && ny >= 0 && nx < W && ny < s.H && s.wall[ny * W + nx] === this.pid) contact++;
            }
          }
          let v: number;
          if (cover > 0) {
            v = cover * 100 - inner * 22 - crowd * 6 + contact * 2;
          } else {
            // Nothing to repair with this piece: dump it where it does the least harm.
            v = -5000 + far * 6 - inner * 60 - crowd * 45 - contact * 3;
          }
          opts.push({ x, y, rot, v: v + this.rng.next() * 2 });
        }
      }
    }
    if (!opts.length) return null;
    opts.sort((a, c) => c.v - a.v);
    if (this.skill.sloppy && this.rng.next() < this.skill.sloppy) {
      const good = opts.filter((o) => o.v >= opts[0].v - 120).slice(0, 4);
      return this.rng.pick(good);
    }
    return opts[0];
  }

  // ---------------------------------------------------------------- cannons

  private cannonTick() {
    const s = this.g.s;
    const p = s.players[this.pid];
    if (p.cannonsToPlace <= 0) return;
    const obs = obstacleMap(s);
    const W = s.W;
    let best: { x: number; y: number; v: number } | null = null;
    for (let y = 0; y < s.H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        if (s.territory[y * W + x] !== this.pid || !canPlaceCannon(s, this.pid, x, y, obs)) continue;
        let walls = 0;
        let packed = 0;
        for (let yy = y - 1; yy <= y + 2; yy++) {
          for (let xx = x - 1; xx <= x + 2; xx++) {
            if ((xx === x || xx === x + 1) && (yy === y || yy === y + 1)) continue;
            if (xx < 0 || yy < 0 || xx >= W || yy >= s.H) continue;
            const i = yy * W + xx;
            if (s.wall[i] === this.pid) walls++;
            else if (obs[i]) packed++;
          }
        }
        const v = -walls * 3 + packed * 2 + this.rng.next();
        if (!best || v > best.v) best = { x, y, v };
      }
    }
    if (best) {
      p.cursorX = best.x;
      p.cursorY = best.y;
      this.g.act(this.pid, { type: 'cannon', x: best.x, y: best.y });
    }
    this.actT = s.time + this.skill.cannonDelay * (0.7 + this.rng.next() * 0.6);
  }

  // ----------------------------------------------------------------- combat

  private combatTick() {
    const s = this.g.s;
    if (s.time < s.fireStart || s.time >= s.fireEnd) return;
    const ready = s.cannons.filter((c) => c.owner === this.pid && c.active && !c.busy);
    if (!ready.length) return;
    const t = s.mode === 'solo' ? this.soloTarget(ready) : this.versusTarget();
    if (t) {
      const err = this.skill.aim;
      const x = t.x + (t.moving ? 0 : this.rng.gauss() * err);
      const y = t.y + (t.moving ? 0 : this.rng.gauss() * err);
      this.g.act(this.pid, { type: 'fire', x, y });
      const p = s.players[this.pid];
      p.cursorX = Math.floor(x);
      p.cursorY = Math.floor(y);
    }
    this.actT = s.time + this.skill.fireDelay * (0.6 + this.rng.next() * 0.8);
  }

  private versusTarget(): { x: number; y: number; moving?: boolean } | null {
    const s = this.g.s;
    const W = s.W;
    const enemies = s.players.filter((p) => p.alive && p.id !== this.pid);
    if (!enemies.length) return null;
    if (this.focus < 0 || !s.players[this.focus]?.alive || this.rng.next() < 0.05) {
      // Prefer nearby rivals and whoever is leading, with some randomness.
      const home = s.castles[s.players[this.pid].home];
      const weights = enemies.map((e) => {
        const eh = s.castles[e.home];
        const d = home && eh ? Math.hypot(eh.x - home.x, eh.y - home.y) : 20;
        return (1 + Math.max(0, e.score) / 3000 + e.castles * 0.3) / (1 + d / 12);
      });
      this.focus = enemies[this.rng.weighted(weights)].id;
    }
    const foe = this.focus;
    if (this.rng.next() < 0.22) {
      const cannons = s.cannons.filter((c) => c.owner === foe && c.active);
      if (cannons.length) {
        const c = this.rng.pick(cannons);
        return { x: c.x + 0.5 + this.rng.int(2), y: c.y + 0.5 + this.rng.int(2) };
      }
    }
    const breach: number[] = [];
    const ring: number[] = [];
    const other: number[] = [];
    for (let i = 0; i < W * s.H; i++) {
      if (s.wall[i] !== foe) continue;
      const x = i % W;
      const y = (i - x) / W;
      let inside = false;
      let outside = false;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= s.H) {
          outside = true;
          continue;
        }
        const n = ny * W + nx;
        if (s.territory[n] === foe) inside = true;
        else if (s.wall[n] < 0) outside = true;
      }
      if (inside && outside) breach.push(i);
      else if (inside) ring.push(i);
      else other.push(i);
    }
    const pool = breach.length ? breach : ring.length ? ring : other;
    if (!pool.length) return null;
    const i = this.rng.pick(pool);
    return { x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 };
  }

  private soloTarget(ready: { x: number; y: number }[]): { x: number; y: number; moving?: boolean } | null {
    const s = this.g.s;
    const ships = s.ships.filter((sh) => sh.sinkT === 0 && sh.x < s.W && sh.x >= 0);
    if (ships.length) {
      const sh = this.rng.pick(ships);
      let c = ready[0];
      let bd = Infinity;
      for (const r of ready) {
        const d = (r.x + 1 - sh.x) ** 2 + (r.y + 1 - sh.y) ** 2;
        if (d < bd) {
          bd = d;
          c = r;
        }
      }
      // Lead the target: solve for where the ship will be when the ball lands.
      let px = sh.x;
      let py = sh.y;
      for (let k = 0; k < 3; k++) {
        const t = flightTime(s.mode, Math.hypot(px - (c.x + 1), py - (c.y + 1)));
        px = sh.x + sh.vx * t;
        py = sh.y + sh.vy * t;
      }
      const err = this.skill.aim * 0.8;
      return { x: px + this.rng.gauss() * err, y: py + this.rng.gauss() * err, moving: true };
    }
    if (s.grunts.length) {
      const gr = this.rng.pick(s.grunts);
      return { x: gr.x + 0.5, y: gr.y + 0.5 };
    }
    return null;
  }
}

const INF = 1 << 20;

/**
 * Minimum vertex cut (max-flow, node splitting): the fewest buildable tiles that must be
 * walled so no 4-connected path leads from the map border into `core`.
 * kind: 0 = own wall (already blocks), 1 = buildable (cost 1), 2/3 = can't be walled.
 * Returns null when the core cannot be sealed.
 */
export function sealingCut(W: number, H: number, kind: Uint8Array, cost: Uint8Array, core: Uint8Array): number[] | null {
  const N = W * H;
  const S = 2 * N;
  const T = 2 * N + 1;
  const maxE = N * 12 + 16;
  const head = new Int32Array(2 * N + 2).fill(-1);
  const to = new Int32Array(maxE);
  const cap = new Int32Array(maxE);
  const nxt = new Int32Array(maxE);
  let ec = 0;
  const add = (u: number, v: number, c: number) => {
    to[ec] = v;
    cap[ec] = c;
    nxt[ec] = head[u];
    head[u] = ec++;
    to[ec] = u;
    cap[ec] = 0;
    nxt[ec] = head[v];
    head[v] = ec++;
  };
  for (let i = 0; i < N; i++) {
    if (kind[i] === 0) continue;
    const x = i % W;
    const y = (i - x) / W;
    add(2 * i, 2 * i + 1, core[i] || kind[i] !== 1 ? INF : Math.max(1, cost[i]));
    if (x > 0 && kind[i - 1] !== 0) add(2 * i + 1, 2 * (i - 1), INF);
    if (x < W - 1 && kind[i + 1] !== 0) add(2 * i + 1, 2 * (i + 1), INF);
    if (y > 0 && kind[i - W] !== 0) add(2 * i + 1, 2 * (i - W), INF);
    if (y < H - 1 && kind[i + W] !== 0) add(2 * i + 1, 2 * (i + W), INF);
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) add(S, 2 * i, INF);
    if (core[i]) add(2 * i + 1, T, INF);
  }
  const prevE = new Int32Array(2 * N + 2);
  const seen = new Int32Array(2 * N + 2);
  const queue = new Int32Array(2 * N + 2);
  let stamp = 0;
  let flow = 0;
  for (;;) {
    stamp++;
    let qh = 0;
    let qt = 0;
    queue[qt++] = S;
    seen[S] = stamp;
    while (qh < qt && seen[T] !== stamp) {
      const u = queue[qh++];
      for (let e = head[u]; e >= 0; e = nxt[e]) {
        const v = to[e];
        if (cap[e] > 0 && seen[v] !== stamp) {
          seen[v] = stamp;
          prevE[v] = e;
          queue[qt++] = v;
        }
      }
    }
    if (seen[T] !== stamp) break;
    let push = INF;
    for (let v = T; v !== S; v = to[prevE[v] ^ 1]) push = Math.min(push, cap[prevE[v]]);
    if (push >= INF) return null;
    for (let v = T; v !== S; v = to[prevE[v] ^ 1]) {
      cap[prevE[v]] -= push;
      cap[prevE[v] ^ 1] += push;
    }
    flow += push;
    if (flow > 400) return null;
  }
  // Take the min cut closest to the core: nodes that can still reach T in the residual graph.
  const reach = new Uint8Array(2 * N + 2);
  let qh = 0;
  let qt = 0;
  queue[qt++] = T;
  reach[T] = 1;
  while (qh < qt) {
    const v = queue[qh++];
    for (let e = head[v]; e >= 0; e = nxt[e]) {
      const u = to[e];
      if (!reach[u] && cap[e ^ 1] > 0) {
        reach[u] = 1;
        queue[qt++] = u;
      }
    }
  }
  const cut: number[] = [];
  for (let i = 0; i < N; i++) {
    if (kind[i] === 1 && !core[i] && reach[2 * i + 1] && !reach[2 * i]) cut.push(i);
  }
  return cut;
}

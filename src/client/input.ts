import { pieceCells } from '../shared/pieces';
import { canPlaceCannon, canPlacePiece, obstacleMap, regionBounds } from '../shared/rules';
import { Player } from '../shared/types';
import { buzz, sfx } from './audio';
import { Session } from './session';

export interface ViewTransform {
  screenToWorld(x: number, y: number): { x: number; y: number };
  readonly scale: number;
}

export type TouchMode = 'drag' | 'direct';

interface Ptr {
  id: number;
  type: string;
  x0: number;
  y0: number;
  lx: number;
  ly: number;
  t0: number;
  moved: boolean;
  gesture: boolean;
}

export interface Ghost {
  kind: 'piece' | 'cannon';
  cells: [number, number][];
  valid: boolean;
}

/**
 * Turns touches, mouse and keys into game actions for the local player.
 * Touch "drag" mode works like a trackpad: drag anywhere to slide the piece,
 * tap on/near it to drop it, tap far away to jump it there.
 */
export class Controller {
  cx = 0;
  cy = 0;
  rot = 0;
  aim: { x: number; y: number } | null = null;
  aimT = 0;
  lastTarget: { x: number; y: number } | null = null;
  touchMode: TouchMode = 'drag';
  invalidFlash = 0;
  session: Session | null = null;
  pending: { seq: number; cells: number[]; t: number } | null = null;
  pendingCannons: { x: number; y: number; t: number }[] = [];
  /** Crater fills sent to the server but not confirmed yet (online). */
  pendingFills: { i: number; t: number }[] = [];
  private pointers = new Map<number, Ptr>();
  private phase = '';
  private bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private sentCursor = '';
  private sentT = 0;
  private mouseInside = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly view: ViewTransform,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.mouseInside = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) > 2) this.rotate(e.deltaY > 0 ? 1 : 3);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.key(e));
  }

  setSession(s: Session | null) {
    this.session = s;
    this.pending = null;
    this.pendingCannons = [];
    this.pendingFills = [];
    this.phase = '';
    this.pointers.clear();
    if (s && s.you >= 0) {
      this.bounds = regionBounds(s.state, s.you);
      const p = s.state.players[s.you];
      this.cx = (p?.cursorX ?? 0) + 0.5;
      this.cy = (p?.cursorY ?? 0) + 0.5;
    }
  }

  get me(): Player | null {
    const s = this.session;
    if (!s || s.you < 0) return null;
    return s.state.players[s.you] ?? null;
  }

  /** Shape the player is holding (the next one while a placement is in flight). */
  currentShape(): number {
    const p = this.me;
    if (!p) return -1;
    return this.pending ? p.next : p.piece;
  }

  pieceAnchor(): [number, number] {
    return [Math.floor(this.cx), Math.floor(this.cy)];
  }

  cannonAnchor(): [number, number] {
    return [Math.round(this.cx - 1), Math.round(this.cy - 1)];
  }

  ghost(): Ghost | null {
    const s = this.session;
    const p = this.me;
    if (!s || !p || !p.alive) return null;
    const st = s.state;
    if (st.phase === 'build') {
      const shape = this.currentShape();
      if (shape < 0) return null;
      const [ax, ay] = this.pieceAnchor();
      const rel = pieceCells(shape, this.rot);
      const valid = !this.pending && canPlacePiece(st, s.you, rel, ax, ay, obstacleMap(st));
      return { kind: 'piece', cells: rel.map(([dx, dy]) => [ax + dx, ay + dy]), valid };
    }
    if (st.phase === 'cannons' && p.cannonsToPlace - this.pendingCannons.length > 0) {
      const [ax, ay] = this.cannonAnchor();
      const valid = canPlaceCannon(st, s.you, ax, ay, obstacleMap(st)) && !this.overlapsPending(ax, ay);
      return {
        kind: 'cannon',
        cells: [
          [ax, ay],
          [ax + 1, ay],
          [ax, ay + 1],
          [ax + 1, ay + 1],
        ],
        valid,
      };
    }
    return null;
  }

  /** Moves the cannon cursor to the closest free spot (so repeated taps place cannons quickly). */
  snapCannon(nearX: number, nearY: number) {
    const s = this.session;
    if (!s || s.you < 0) return;
    const st = s.state;
    const obs = obstacleMap(st);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let y = 0; y < st.H - 1; y++) {
      for (let x = 0; x < st.W - 1; x++) {
        if (st.territory[y * st.W + x] !== s.you || !canPlaceCannon(st, s.you, x, y, obs) || this.overlapsPending(x, y)) continue;
        const d = (x + 1 - nearX) ** 2 + (y + 1 - nearY) ** 2;
        if (d < bd) {
          bd = d;
          best = [x, y];
        }
      }
    }
    if (best) {
      this.cx = best[0] + 1;
      this.cy = best[1] + 1;
    }
  }

  private overlapsPending(x: number, y: number) {
    return this.pendingCannons.some((c) => Math.abs(c.x - x) < 2 && Math.abs(c.y - y) < 2);
  }

  private clampCursor() {
    const b = this.bounds;
    this.cx = Math.max(b.x0 - 1, Math.min(b.x1 + 2, this.cx));
    this.cy = Math.max(b.y0 - 1, Math.min(b.y1 + 2, this.cy));
  }

  rotate(dir = 1) {
    if (this.session?.state.phase !== 'build') return;
    this.rot = (this.rot + dir) % 4;
    sfx.rotate();
  }

  place() {
    const s = this.session;
    const p = this.me;
    if (!s || !p || !p.alive) return;
    const st = s.state;
    const g = this.ghost();
    if (!g) return;
    if (!g.valid) {
      this.invalidFlash = 0.35;
      sfx.bad();
      buzz(40);
      return;
    }
    if (g.kind === 'piece') {
      const [x, y] = this.pieceAnchor();
      const seq = p.pieceSeq;
      if (s.act({ type: 'place', x, y, rot: this.rot, seq })) {
        sfx.place();
        buzz(12);
        if (s.online) this.pending = { seq: seq + 1, cells: g.cells.map(([cx, cy]) => cy * st.W + cx), t: performance.now() };
      }
    } else {
      const [x, y] = this.cannonAnchor();
      if (s.act({ type: 'cannon', x, y })) {
        sfx.place();
        buzz(20);
        if (s.online) this.pendingCannons.push({ x, y, t: performance.now() });
        if (p.cannonsToPlace - this.pendingCannons.length > (s.online ? 0 : -1)) this.snapCannon(x + 1, y + 1);
      }
    }
  }

  /** Tile index of a crater at world point (x, y) the player may shovel flat right now, or -1. */
  fillableAt(x: number, y: number): number {
    const s = this.session;
    const p = this.me;
    if (!s || !p || !p.alive || s.state.phase !== 'build' || p.fills - this.pendingFills.length <= 0) return -1;
    const st = s.state;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) return -1;
    const i = ty * st.W + tx;
    if (!st.crater[i] || st.region[i] !== s.you || st.wall[i] >= 0) return -1;
    if (st.grunts.some((g) => g.x === tx && g.y === ty) || this.pendingFills.some((f) => f.i === i)) return -1;
    return i;
  }

  /** Shovels the crater at tile i back to flat ground. */
  fill(i: number): boolean {
    const s = this.session;
    if (!s || i < 0) return false;
    const x = i % s.state.W;
    const y = Math.floor(i / s.state.W);
    if (!s.act({ type: 'fill', x, y })) return false;
    sfx.shovel();
    buzz(15);
    if (s.online) this.pendingFills.push({ i, t: performance.now() });
    return true;
  }

  /** Keyboard: fill a crater under the piece. */
  private fillUnderPiece() {
    const g = this.ghost();
    if (!g || g.kind !== 'piece') return;
    for (const [x, y] of g.cells) {
      const i = this.fillableAt(x + 0.5, y + 0.5);
      if (i >= 0) {
        this.fill(i);
        return;
      }
    }
    sfx.bad();
  }

  fire(x: number, y: number) {
    const s = this.session;
    const p = this.me;
    if (!s || !p || !p.alive) return;
    const st = s.state;
    if (st.phase !== 'combat') return;
    const t = s.now();
    if (t < st.fireStart || t >= st.fireEnd) return;
    this.aim = { x, y };
    this.aimT = performance.now();
    this.lastTarget = { x, y };
    if (!st.cannons.some((c) => c.owner === s.you && c.active)) return;
    s.act({ type: 'fire', x, y });
  }

  private selectAt(x: number, y: number) {
    const s = this.session;
    if (!s || s.state.phase !== 'select') return;
    let best = -1;
    let bd = 9;
    for (const c of s.state.castles) {
      if (c.region !== s.you) continue;
      const d = (c.x + 1 - x) ** 2 + (c.y + 1 - y) ** 2;
      if (d < bd) {
        bd = d;
        best = c.id;
      }
    }
    if (best >= 0) {
      s.act({ type: 'select', castle: best });
      sfx.castle();
      buzz(15);
    } else {
      sfx.bad();
    }
  }

  // ------------------------------------------------------------- pointers

  private down(e: PointerEvent) {
    e.preventDefault();
    sfx.unlock();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const ptr: Ptr = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: false, gesture: false };
    this.pointers.set(e.pointerId, ptr);
    const s = this.session;
    if (!s) return;
    const phase = s.state.phase;
    const w = this.view.screenToWorld(e.clientX, e.clientY);
    if (phase === 'combat') {
      if (e.pointerType !== 'mouse' || e.button === 0) this.fire(w.x, w.y);
      return;
    }
    if (phase === 'build' || phase === 'cannons') {
      if (e.pointerType === 'mouse') {
        if (e.button === 2) {
          this.rotate();
          ptr.gesture = true;
        }
        return;
      }
      const touches = [...this.pointers.values()].filter((p) => p.type !== 'mouse');
      if (touches.length >= 2) {
        // Two-finger tap rotates.
        for (const t of touches) t.gesture = true;
        this.rotate();
        return;
      }
      if (this.touchMode === 'direct') this.directTo(w);
    }
  }

  private directTo(w: { x: number; y: number }) {
    const lift = Math.max(1.8, 46 / this.view.scale);
    this.cx = w.x;
    this.cy = w.y - lift;
    this.clampCursor();
  }

  private move(e: PointerEvent) {
    const s = this.session;
    if (!s) return;
    const phase = s.state.phase;
    const w = this.view.screenToWorld(e.clientX, e.clientY);
    const ptr = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse') {
      this.mouseInside = true;
      if (phase === 'build' || phase === 'cannons') {
        this.cx = w.x + (phase === 'cannons' ? 0.5 : 0);
        this.cy = w.y + (phase === 'cannons' ? 0.5 : 0);
        this.clampCursor();
      } else if (phase === 'combat') {
        this.aim = w;
        this.aimT = performance.now();
      }
      return;
    }
    if (!ptr) return;
    const dx = e.clientX - ptr.lx;
    const dy = e.clientY - ptr.ly;
    ptr.lx = e.clientX;
    ptr.ly = e.clientY;
    if (Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > 10) ptr.moved = true;
    if (ptr.gesture) return;
    if (phase === 'build' || phase === 'cannons') {
      if (this.touchMode === 'direct') this.directTo(w);
      else {
        this.cx += dx / this.view.scale;
        this.cy += dy / this.view.scale;
        this.clampCursor();
      }
    } else if (phase === 'combat') {
      this.aim = w;
      this.aimT = performance.now();
    }
  }

  private up(e: PointerEvent) {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const s = this.session;
    if (!ptr || !s || ptr.gesture) return;
    const phase = s.state.phase;
    const w = this.view.screenToWorld(e.clientX, e.clientY);
    const tap = !ptr.moved && performance.now() - ptr.t0 < 450;
    if (phase === 'select') {
      if (tap || e.pointerType === 'mouse') this.selectAt(w.x, w.y);
      return;
    }
    if (phase !== 'build' && phase !== 'cannons') return;
    // Clicking or tapping straight on a crater shovels it flat.
    const crater = phase === 'build' && (tap || e.pointerType === 'mouse') ? this.fillableAt(w.x, w.y) : -1;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) {
        if (crater >= 0) this.fill(crater);
        else this.place();
      }
      return;
    }
    if (crater >= 0) {
      this.fill(crater);
      return;
    }
    if (this.touchMode === 'direct') {
      this.place();
      return;
    }
    if (!tap) return;
    const g = this.ghost();
    let gx = this.cx;
    let gy = this.cy;
    if (g) {
      gx = g.cells.reduce((a, c) => a + c[0] + 0.5, 0) / g.cells.length;
      gy = g.cells.reduce((a, c) => a + c[1] + 0.5, 0) / g.cells.length;
    }
    if (Math.hypot(w.x - gx, w.y - gy) > 3.2) {
      // Tap far from the piece: move it there instead of dropping it.
      this.cx = w.x + (phase === 'cannons' ? 0.5 : 0);
      this.cy = w.y + (phase === 'cannons' ? 0.5 : 0);
      this.clampCursor();
    } else {
      this.place();
    }
  }

  private key(e: KeyboardEvent) {
    const s = this.session;
    if (!s || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const phase = s.state.phase;
    const k = e.key;
    let dx = 0;
    let dy = 0;
    if (k === 'ArrowLeft' || k === 'a') dx = -1;
    else if (k === 'ArrowRight' || k === 'd') dx = 1;
    else if (k === 'ArrowUp' || k === 'w') dy = -1;
    else if (k === 'ArrowDown' || k === 's') dy = 1;
    if (dx || dy) {
      e.preventDefault();
      if (phase === 'combat') {
        const a = this.aim ?? this.lastTarget ?? { x: s.state.W / 2, y: s.state.H / 2 };
        this.aim = { x: Math.max(0, Math.min(s.state.W - 0.01, a.x + dx)), y: Math.max(0, Math.min(s.state.H - 0.01, a.y + dy)) };
        this.aimT = performance.now();
      } else {
        this.cx += dx;
        this.cy += dy;
        this.clampCursor();
      }
      return;
    }
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      sfx.unlock();
      if (phase === 'combat' && this.aim) this.fire(this.aim.x, this.aim.y);
      else if (phase === 'select') {
        const p = this.me;
        const c = s.state.castles.find((cc) => cc.region === s.you && cc.id !== p?.home) ?? null;
        if (c) this.selectAt(c.x + 1, c.y + 1);
      } else this.place();
    } else if (k === 'r' || k === 'x' || k === 'z' || k === 'Shift') {
      this.rotate(k === 'z' ? 3 : 1);
    } else if (k === 'f' && phase === 'build') {
      this.fillUnderPiece();
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    const s = this.session;
    const p = this.me;
    this.invalidFlash = Math.max(0, this.invalidFlash - dt);
    if (!s || !p) return;
    const st = s.state;
    if (st.phase !== this.phase) {
      const prev = this.phase;
      this.phase = st.phase;
      this.pointers.clear();
      if (st.phase === 'cannons' && prev !== 'cannons') {
        const home = st.castles[p.home];
        if (home) this.snapCannon(home.x + 1, home.y + 3);
      }
      if (st.phase === 'build' && prev === '') {
        this.cx = p.cursorX + 0.5;
        this.cy = p.cursorY + 0.5;
      }
      if (st.phase === 'combat') this.aim = null;
    }
    const now = performance.now();
    if (this.pending && (p.pieceSeq >= this.pending.seq || now - this.pending.t > 2000 || st.phase !== 'build')) this.pending = null;
    if (this.pendingFills.length) {
      this.pendingFills = this.pendingFills.filter((f) => st.phase === 'build' && now - f.t < 2000 && st.crater[f.i] > 0);
    }
    if (this.pendingCannons.length) {
      this.pendingCannons = this.pendingCannons.filter(
        (pc) => st.phase === 'cannons' && now - pc.t < 2000 && !st.cannons.some((c) => c.owner === s.you && c.x === pc.x && c.y === pc.y),
      );
    }
    if (s.online && (st.phase === 'build' || st.phase === 'cannons') && now - this.sentT > 150) {
      const [x, y] = st.phase === 'build' ? this.pieceAnchor() : this.cannonAnchor();
      const key = `${x},${y},${this.rot}`;
      if (key !== this.sentCursor) {
        this.sentCursor = key;
        this.sentT = now;
        s.act({ type: 'cursor', x, y, rot: this.rot });
      }
    }
  }

  get showHover() {
    return this.mouseInside;
  }
}

import { PLAYER_COLORS, SHIP_FLAGSHIP, SHIP_RADIUS, arcHeight } from '../shared/constants';
import { pieceCells } from '../shared/pieces';
import { regionBounds } from '../shared/rules';
import { Ball, GameState, Trail } from '../shared/types';
import { Effects } from './effects';
import { Controller, ViewTransform } from './input';
import { Session } from './session';
import { CANNON_METAL } from './factions';
import { SpriteSet, TS, renderStructures, renderTerrain } from './sprites';

const SEA = '#1a4488';

export class Renderer implements ViewTransform {
  readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  vw = 0;
  vh = 0;
  top = 0;
  readonly sprites = new SpriteSet();
  private terrain: HTMLCanvasElement | null = null;
  private notMine: HTMLCanvasElement | null = null;
  private struct: HTMLCanvasElement | null = null;
  private mapState: GameState | null = null;
  private structVersion = -1;
  private cam = { x: 0, y: 0, s: 10 };
  private camReady = false;
  /** null = automatic (zoom in on small screens while building). */
  zoomBuild: boolean | null = null;
  zoomCombat = false;
  readonly fx = new Effects();
  private gruntPos = new Map<number, { x: number; y: number }>();
  private shakeX = 0;
  private shakeY = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  get scale() {
    return this.cam.s;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
  }

  private get cy0() {
    return this.top + (this.vh - this.top) / 2;
  }

  screenToWorld(x: number, y: number) {
    return { x: (x - this.vw / 2) / this.cam.s + this.cam.x, y: (y - this.cy0) / this.cam.s + this.cam.y };
  }

  sx = (x: number) => (x - this.cam.x) * this.cam.s + this.vw / 2 + this.shakeX;
  sy = (y: number) => (y - this.cam.y) * this.cam.s + this.cy0 + this.shakeY;

  /** Is zooming in useful at all on this screen? */
  canZoom(s: GameState): boolean {
    return this.fitScale(s) < 30;
  }

  private fitScale(s: GameState) {
    return Math.min(this.vw / s.W, (this.vh - this.top) / s.H);
  }

  private prepare(s: GameState, you: number) {
    if (this.mapState !== s) {
      this.mapState = s;
      this.terrain = renderTerrain(s);
      this.struct = null;
      this.structVersion = -1;
      this.camReady = false;
      this.gruntPos.clear();
      // Dim everything that is not the local player's land while building.
      const c = document.createElement('canvas');
      c.width = s.W;
      c.height = s.H;
      const g = c.getContext('2d')!;
      const img = g.createImageData(s.W, s.H);
      for (let i = 0; i < s.W * s.H; i++) img.data[i * 4 + 3] = s.region[i] === you ? 0 : 255;
      g.putImageData(img, 0, 0);
      this.notMine = c;
    }
    if (this.structVersion !== s.gridVersion || !this.struct) {
      this.struct = renderStructures(s, this.sprites, this.struct);
      this.structVersion = s.gridVersion;
    }
  }

  invalidate() {
    this.structVersion = -1;
  }

  private updateCamera(sess: Session, ctrl: Controller, dt: number) {
    const s = sess.state;
    const viewW = this.vw;
    const viewH = this.vh - this.top;
    const fit = this.fitScale(s);
    const phase = s.phase;
    const buildish = phase === 'select' || phase === 'autobuild' || phase === 'build' || phase === 'cannons';
    const me = sess.you >= 0 ? s.players[sess.you] : null;
    let focus = false;
    if (buildish && me?.alive) focus = this.zoomBuild ?? fit < 22;
    else if (phase === 'combat') focus = this.zoomCombat;
    const zoomed = Math.min(44, Math.max(fit * 1.6, 28));
    const ts = focus ? Math.max(fit, zoomed) : fit;

    let px = s.W / 2;
    let py = s.H / 2;
    if (focus) {
      if (phase === 'build' || phase === 'cannons') {
        px = ctrl.cx;
        py = ctrl.cy;
      } else if (phase === 'combat') {
        const t = ctrl.lastTarget ?? ctrl.aim;
        if (t) {
          px = t.x;
          py = t.y;
        }
      } else if (me) {
        const home = s.castles[me.home];
        if (home) {
          px = home.x + 1;
          py = home.y + 1;
        } else {
          const b = regionBounds(s, me.id);
          px = (b.x0 + b.x1 + 1) / 2;
          py = (b.y0 + b.y1 + 1) / 2;
        }
      }
    }
    let tx = this.camReady ? this.cam.x : px;
    let ty = this.camReady ? this.cam.y : py;
    if (focus) {
      // Dead zone: only scroll once the point of interest nears the edge.
      const hx = (viewW / 2 / ts) * 0.45;
      const hy = (viewH / 2 / ts) * 0.4;
      if (px < tx - hx) tx = px + hx;
      if (px > tx + hx) tx = px - hx;
      if (py < ty - hy) ty = py + hy;
      if (py > ty + hy) ty = py - hy;
    }
    const halfW = viewW / 2 / ts;
    const halfH = viewH / 2 / ts;
    tx = s.W <= halfW * 2 ? s.W / 2 : Math.max(halfW, Math.min(s.W - halfW, tx));
    ty = s.H <= halfH * 2 ? s.H / 2 : Math.max(halfH, Math.min(s.H - halfH, ty));
    if (!this.camReady) {
      this.cam = { x: tx, y: ty, s: ts };
      this.camReady = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 9);
    this.cam.s += (ts - this.cam.s) * k;
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  frame(sess: Session, ctrl: Controller, dt: number) {
    const s = sess.state;
    const ctx = this.ctx;
    this.prepare(s, sess.you);
    this.updateCamera(sess, ctrl, dt);
    this.fx.update(dt);
    const sh = this.fx.shake;
    this.shakeX = sh ? (Math.random() - 0.5) * sh * 30 : 0;
    this.shakeY = sh ? (Math.random() - 0.5) * sh * 30 : 0;
    const now = sess.now();
    const sc = this.cam.s;
    const sx = this.sx;
    const sy = this.sy;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, this.vw, this.vh);
    const x0 = sx(0);
    const y0 = sy(0);
    ctx.drawImage(this.terrain!, x0, y0, s.W * sc, s.H * sc);

    const buildish = s.phase === 'build' || s.phase === 'cannons' || s.phase === 'select';
    const me = sess.you >= 0 ? s.players[sess.you] : null;
    if (buildish && me?.alive && this.notMine) {
      ctx.globalAlpha = 0.28;
      ctx.drawImage(this.notMine, x0, y0, s.W * sc, s.H * sc);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.struct!, x0, y0, s.W * sc, s.H * sc);

    // Optimistic (not yet confirmed) placements.
    if (ctrl.pending && me) {
      ctx.globalAlpha = 0.8;
      for (const i of ctrl.pending.cells) ctx.drawImage(this.sprites.walls(me.faction, sess.you)[0], sx(i % s.W), sy(Math.floor(i / s.W)), sc + 0.5, sc + 0.5);
      ctx.globalAlpha = 1;
    }
    if (s.phase === 'build' && me?.alive) this.drawFillable(sess, ctrl, now);

    this.drawCastles(s, sess.you, now);
    for (const c of s.cannons) this.drawCannon(c.x, c.y, c.owner, c.active, c.angle, c.hp, s.players[c.owner]?.faction ?? 0);
    for (const pc of ctrl.pendingCannons) this.drawCannon(pc.x, pc.y, sess.you, true, -Math.PI / 2, 3, me?.faction ?? 0);
    this.drawGrunts(s, dt);
    this.drawShips(s, now);
    this.drawOtherCursors(s, sess.you, now);
    this.drawGhost(ctrl, sess.you, now);
    this.drawBalls(s, now);
    this.fx.draw(ctx, sx, sy, sc);
    this.drawCrosshair(s, ctrl, sess.you);
  }

  private drawCastles(s: GameState, you: number, now: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    const pulse = 0.5 + 0.5 * Math.sin(now * 5);
    for (const c of s.castles) {
      const x = this.sx(c.x);
      const y = this.sy(c.y);
      ctx.drawImage(this.sprites.castle(s.players[c.region]?.faction ?? 0, c.owner), x, y, sc * 2, sc * 2);
      const isHome = s.players.some((p) => p.home === c.id);
      if (s.phase === 'select' && c.region === you) {
        const chosen = s.players[you]?.home === c.id;
        ctx.strokeStyle = chosen ? '#ffe066' : `rgba(255,230,102,${0.35 + pulse * 0.6})`;
        ctx.lineWidth = Math.max(2, sc * (chosen ? 0.18 : 0.1));
        ctx.beginPath();
        ctx.arc(x + sc, y + sc, sc * (1.5 + (chosen ? 0 : pulse * 0.25)), 0, Math.PI * 2);
        ctx.stroke();
      } else if (isHome && s.phase !== 'select') {
        this.drawCrown(x + sc * 0.2, y + sc * 0.05, sc * 0.55);
      }
    }
  }

  private drawCrown(x: number, y: number, w: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffd23a';
    ctx.strokeStyle = '#6b4a00';
    ctx.lineWidth = Math.max(1, w * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y + w * 0.7);
    ctx.lineTo(x, y + w * 0.2);
    ctx.lineTo(x + w * 0.25, y + w * 0.45);
    ctx.lineTo(x + w * 0.5, y);
    ctx.lineTo(x + w * 0.75, y + w * 0.45);
    ctx.lineTo(x + w, y + w * 0.2);
    ctx.lineTo(x + w, y + w * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** Pulses the craters the player can still shovel flat (tap one to fill it). */
  private drawFillable(sess: Session, ctrl: Controller, now: number) {
    const s = sess.state;
    const me = s.players[sess.you];
    if (!me || me.fills - ctrl.pendingFills.length <= 0) return;
    const ctx = this.ctx;
    const sc = this.cam.s;
    const pulse = 0.5 + 0.5 * Math.sin(now * 4);
    ctx.beginPath();
    for (let i = 0; i < s.W * s.H; i++) {
      if (!s.crater[i] || s.region[i] !== sess.you || s.wall[i] >= 0 || ctrl.pendingFills.some((f) => f.i === i)) continue;
      const x = this.sx(i % s.W);
      const y = this.sy(Math.floor(i / s.W));
      ctx.rect(x + sc * 0.06, y + sc * 0.06, sc * 0.88, sc * 0.88);
    }
    ctx.fillStyle = `rgba(255,214,90,${0.12 + pulse * 0.18})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,224,110,${0.55 + pulse * 0.45})`;
    ctx.lineWidth = Math.max(1.5, sc * 0.1);
    ctx.stroke();
  }

  drawCannon(tx: number, ty: number, owner: number, active: boolean, angle: number, hp: number, faction = 0) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    const cx = this.sx(tx + 1);
    const cy = this.sy(ty + 1);
    const r = sc * 0.72;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + sc * 0.1, cy + sc * 0.18, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = active ? '#4a4038' : '#707070';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, sc * 0.12);
    ctx.strokeStyle = active ? PLAYER_COLORS[owner] ?? '#aaa' : '#9a9a9a';
    ctx.stroke();
    ctx.fillStyle = active ? '#6b5a4a' : '#8a8a8a';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const len = sc * 1.0;
    const bw = sc * 0.36;
    const [metal, band] = CANNON_METAL[faction] ?? CANNON_METAL[0];
    ctx.fillStyle = active ? metal : '#555';
    ctx.fillRect(-sc * 0.15, -bw / 2, len, bw);
    ctx.fillStyle = active ? band : '#777';
    ctx.fillRect(len - sc * 0.3, -bw * 0.62, sc * 0.18, bw * 1.24);
    ctx.fillRect(sc * 0.12, -bw * 0.56, sc * 0.1, bw * 1.12);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-sc * 0.1, -bw / 2 + 1, len - sc * 0.2, Math.max(1, bw * 0.18));
    ctx.restore();
    if (hp < 3) {
      ctx.fillStyle = hp === 1 ? '#ff5a3a' : '#ffb347';
      for (let i = 0; i < 3 - hp; i++) ctx.fillRect(cx - r + i * sc * 0.28, cy + r * 0.6, sc * 0.2, sc * 0.2);
    }
  }

  private drawGrunts(s: GameState, dt: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    const alive = new Set<number>();
    for (const g of s.grunts) {
      alive.add(g.id);
      let p = this.gruntPos.get(g.id);
      if (!p) {
        p = { x: g.x, y: g.y };
        this.gruntPos.set(g.id, p);
      }
      const k = 1 - Math.exp(-dt * 8);
      const dx = g.x - p.x;
      const dy = g.y - p.y;
      p.x += dx * k;
      p.y += dy * k;
      const x = this.sx(p.x + 0.5);
      const y = this.sy(p.y + 0.5);
      const w = sc * 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x - w / 2 + sc * 0.08, y - w / 2 + sc * 0.12, w, w);
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(x - w / 2, y - w / 2, w, w * 0.22);
      ctx.fillRect(x - w / 2, y + w / 2 - w * 0.22, w, w * 0.22);
      ctx.fillStyle = '#566b2d';
      ctx.fillRect(x - w * 0.4, y - w * 0.3, w * 0.8, w * 0.6);
      ctx.fillStyle = '#3c4c1e';
      ctx.beginPath();
      ctx.arc(x, y, w * 0.24, 0, Math.PI * 2);
      ctx.fill();
      const a = Math.atan2(dy, dx) || Math.PI;
      ctx.strokeStyle = '#1e1e1e';
      ctx.lineWidth = Math.max(1.5, w * 0.12);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * w * 0.55, y + Math.sin(a) * w * 0.55);
      ctx.stroke();
    }
    for (const id of this.gruntPos.keys()) if (!alive.has(id)) this.gruntPos.delete(id);
  }

  private drawShips(s: GameState, now: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    for (const sh of s.ships) {
      const ahead = Math.max(0, Math.min(0.25, now - s.time));
      const x = this.sx(sh.x + sh.vx * ahead);
      const y = this.sy(sh.y + sh.vy * ahead);
      const L = sc * (SHIP_RADIUS[sh.kind] * 1.9);
      const Wd = L * 0.4;
      let alpha = 1;
      let shrink = 1;
      if (sh.sinkT > 0) {
        const t = Math.min(1, (now - sh.sinkT) / 1.5);
        alpha = 1 - t;
        shrink = 1 - t * 0.4;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      // Wake
      if (Math.hypot(sh.vx, sh.vy) > 0.1 && !sh.sinkT) {
        ctx.strokeStyle = 'rgba(230,245,255,0.5)';
        ctx.lineWidth = Math.max(1, sc * 0.08);
        ctx.beginPath();
        const bx = -Math.cos(sh.angle);
        const by = -Math.sin(sh.angle);
        const nx = -by;
        const ny = bx;
        ctx.moveTo(bx * L * 0.4 + nx * Wd * 0.4, by * L * 0.4 + ny * Wd * 0.4);
        ctx.lineTo(bx * L * 1.1 + nx * Wd, by * L * 1.1 + ny * Wd);
        ctx.moveTo(bx * L * 0.4 - nx * Wd * 0.4, by * L * 0.4 - ny * Wd * 0.4);
        ctx.lineTo(bx * L * 1.1 - nx * Wd, by * L * 1.1 - ny * Wd);
        ctx.stroke();
      }
      ctx.rotate(sh.angle + (sh.sinkT ? (now - sh.sinkT) * 0.6 : 0));
      ctx.scale(shrink, shrink);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(sc * 0.08, sc * 0.12, L / 2, Wd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Hull
      ctx.fillStyle = '#5a3216';
      ctx.beginPath();
      ctx.moveTo(L / 2, 0);
      ctx.quadraticCurveTo(L * 0.2, -Wd / 2, -L / 2, -Wd * 0.42);
      ctx.lineTo(-L / 2, Wd * 0.42);
      ctx.quadraticCurveTo(L * 0.2, Wd / 2, L / 2, 0);
      ctx.fill();
      ctx.fillStyle = '#9a6330';
      ctx.beginPath();
      ctx.moveTo(L * 0.4, 0);
      ctx.quadraticCurveTo(L * 0.15, -Wd * 0.36, -L * 0.44, -Wd * 0.3);
      ctx.lineTo(-L * 0.44, Wd * 0.3);
      ctx.quadraticCurveTo(L * 0.15, Wd * 0.36, L * 0.4, 0);
      ctx.fill();
      // Masts and sails (the pirate flagship flies black sails).
      const flagship = sh.kind === SHIP_FLAGSHIP;
      const masts = sh.kind + 1;
      if (flagship) {
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(-L * 0.46, -Wd * 0.3, L * 0.14, Wd * 0.6);
      }
      for (let m = 0; m < masts; m++) {
        const mx = L * (0.2 - (m / Math.max(1, masts)) * 0.55);
        ctx.fillStyle = flagship ? '#26222a' : '#f2ead6';
        ctx.fillRect(mx - sc * 0.08, -Wd * 0.62, sc * 0.16, Wd * 1.24);
        ctx.fillStyle = flagship ? '#4a4450' : '#c9bea3';
        ctx.fillRect(mx - sc * 0.08, -Wd * 0.62, sc * 0.05, Wd * 1.24);
        ctx.fillStyle = '#3b2a1a';
        ctx.beginPath();
        ctx.arc(mx, 0, sc * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      // Pennant (a skull and crossbones on the flagship)
      ctx.fillStyle = '#111';
      const pw = flagship ? sc * 0.5 : sc * 0.24;
      ctx.fillRect(-L * 0.5 - pw, -sc * (flagship ? 0.18 : 0.08), pw, sc * (flagship ? 0.36 : 0.16));
      if (flagship) {
        ctx.fillStyle = '#f2f2f2';
        ctx.fillRect(-L * 0.5 - pw * 0.62, -sc * 0.08, sc * 0.14, sc * 0.14);
      }
      ctx.restore();
      // Damage pips
      if (!sh.sinkT && sh.hp > 0 && sh.kind > 0) {
        const pip = sc * 0.3;
        for (let i = 0; i < sh.hp; i++) {
          ctx.fillStyle = flagship ? '#ffd23a' : '#ff4d4d';
          ctx.fillRect(x - (sh.hp * pip) / 2 + i * pip + sc * 0.05, y - L * 0.55 - sc * 0.2, sc * 0.2, sc * 0.12);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawOtherCursors(s: GameState, you: number, now: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    if (s.phase !== 'build' && s.phase !== 'cannons') return;
    for (const p of s.players) {
      if (p.id === you || !p.alive || p.cursorX < 0 || p.cursorX >= s.W || p.cursorY < 0 || p.cursorY >= s.H) continue;
      if (s.region[p.cursorY * s.W + p.cursorX] !== p.id) continue;
      ctx.globalAlpha = 0.35 + 0.1 * Math.sin(now * 4);
      ctx.fillStyle = PLAYER_COLORS[p.id];
      if (s.phase === 'build' && p.piece >= 0) {
        for (const [dx, dy] of pieceCells(p.piece, p.rot)) ctx.fillRect(this.sx(p.cursorX + dx), this.sy(p.cursorY + dy), sc, sc);
      } else if (s.phase === 'cannons' && p.cannonsToPlace > 0) {
        ctx.fillRect(this.sx(p.cursorX), this.sy(p.cursorY), sc * 2, sc * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawGhost(ctrl: Controller, you: number, now: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    const g = ctrl.ghost();
    if (!g) return;
    const faction = ctrl.me?.faction ?? 0;
    const pulse = 0.5 + 0.5 * Math.sin(now * 8);
    const set = new Set(g.cells.map(([x, y]) => `${x},${y}`));
    if (g.kind === 'cannon') {
      const [x, y] = g.cells[0];
      ctx.globalAlpha = 0.75;
      this.drawCannon(x, y, you, g.valid, -Math.PI / 2, 3, faction);
      ctx.globalAlpha = 1;
    }
    for (const [x, y] of g.cells) {
      const px = this.sx(x);
      const py = this.sy(y);
      if (g.kind === 'piece') {
        if (g.valid) {
          const mask = (set.has(`${x},${y - 1}`) ? 1 : 0) | (set.has(`${x + 1},${y}`) ? 2 : 0) | (set.has(`${x},${y + 1}`) ? 4 : 0) | (set.has(`${x - 1},${y}`) ? 8 : 0);
          ctx.globalAlpha = 0.85;
          ctx.drawImage(this.sprites.walls(faction, you)[mask], px, py, sc, sc);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(255,40,40,0.55)';
          ctx.fillRect(px, py, sc, sc);
        }
      } else if (!g.valid) {
        ctx.fillStyle = 'rgba(255,40,40,0.4)';
        ctx.fillRect(px, py, sc, sc);
      }
    }
    // Outline around the whole shape.
    ctx.strokeStyle = g.valid ? `rgba(255,255,255,${0.6 + pulse * 0.4})` : ctrl.invalidFlash > 0 ? '#ff2020' : 'rgba(255,90,90,0.9)';
    ctx.lineWidth = Math.max(1.5, sc * 0.1);
    ctx.beginPath();
    for (const [x, y] of g.cells) {
      const px = this.sx(x);
      const py = this.sy(y);
      if (!set.has(`${x},${y - 1}`)) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + sc, py);
      }
      if (!set.has(`${x},${y + 1}`)) {
        ctx.moveTo(px, py + sc);
        ctx.lineTo(px + sc, py + sc);
      }
      if (!set.has(`${x - 1},${y}`)) {
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + sc);
      }
      if (!set.has(`${x + 1},${y}`)) {
        ctx.moveTo(px + sc, py);
        ctx.lineTo(px + sc, py + sc);
      }
    }
    ctx.stroke();
  }

  private drawBalls(s: GameState, now: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    for (const b of s.balls) {
      const t = (now - b.t0) / b.dur;
      if (t < 0 || t >= 1) continue;
      const gx = b.fx + (b.tx - b.fx) * t;
      const gy = b.fy + (b.ty - b.fy) * t;
      const dist = Math.hypot(b.tx - b.fx, b.ty - b.fy);
      // Long shots are lobbed high: the shadow shrinks while the ball climbs towards the viewer.
      const h = Math.sin(Math.PI * t) * arcHeight(dist);
      const shade = 1 / (1 + h * 0.08);
      ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.2 * shade})`;
      ctx.beginPath();
      ctx.ellipse(this.sx(gx), this.sy(gy), sc * 0.2 * (0.5 + shade * 0.5), sc * 0.13 * (0.5 + shade * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
      const r = sc * 0.17 * (1 + Math.min(h, 10) * 0.07);
      const trail = b.owner >= 0 ? (s.players[b.owner]?.look.trail ?? 'none') : 'none';
      if (trail !== 'none') this.drawTrail(b, t, trail, now, r);
      const bx = this.sx(gx);
      const by = this.sy(gy - h);
      ctx.fillStyle = b.owner < 0 ? '#2a1010' : '#111';
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(bx - r * 0.45, by - r * 0.45, Math.max(1, r * 0.4), Math.max(1, r * 0.4));
    }
  }

  /** An earned cannonball trail: a few puffs, embers or sparks along the recent arc. */
  private drawTrail(b: Ball, t: number, trail: Trail, now: number, r: number) {
    const ctx = this.ctx;
    const sc = this.cam.s;
    const dx = b.tx - b.fx;
    const dy = b.ty - b.fy;
    const arc = arcHeight(Math.hypot(dx, dy));
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const N = 8;
    for (let k = N; k >= 1; k--) {
      const tt = t - (k * 0.045) / b.dur;
      if (tt <= 0) continue;
      const fade = 1 - k / (N + 1);
      let wob = 0;
      if (trail === 'arcane') wob = Math.sin(now * 9 + k * 0.9 + b.id) * 0.18;
      else if (trail === 'gold') wob = Math.sin(k * 1.7 + b.id) * 0.14;
      const x = this.sx(b.fx + dx * tt + nx * wob);
      const y = this.sy(b.fy + dy * tt + ny * wob - Math.sin(Math.PI * tt) * arc);
      switch (trail) {
        case 'smoke':
          ctx.fillStyle = `rgba(70,70,74,${0.5 * fade})`;
          ctx.beginPath();
          ctx.arc(x, y, r * (0.7 + k * 0.18), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'fire': {
          const cols = ['#fff2a8', '#ffd34d', '#ff9a2a', '#ff6a2a', '#d23a1a'];
          const sz = Math.max(1.5, r * 1.6 * fade);
          const j = Math.sin(now * 40 + k * 2.3) * sc * 0.05;
          ctx.globalAlpha = fade;
          ctx.fillStyle = cols[Math.min(cols.length - 1, k >> 1)];
          ctx.fillRect(x - sz / 2 + j, y - sz / 2 - j, sz, sz);
          ctx.globalAlpha = 1;
          break;
        }
        case 'gold': {
          const tw = 0.5 + 0.5 * Math.sin(now * 22 + k * 2 + b.id);
          const sz = Math.max(1.5, sc * 0.12 * (0.6 + tw * 0.6));
          ctx.globalAlpha = fade * (0.4 + tw * 0.6);
          ctx.fillStyle = k % 2 ? '#ffd23a' : '#fff6b0';
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
          ctx.globalAlpha = 1;
          break;
        }
        case 'arcane':
          ctx.globalAlpha = 0.85 * fade;
          ctx.fillStyle = k % 2 ? '#b565ff' : '#62e0ff';
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.2, r * (1.1 - k * 0.08)), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
      }
    }
  }

  private drawCrosshair(s: GameState, ctrl: Controller, you: number) {
    if (s.phase !== 'combat' || !ctrl.aim) return;
    const age = performance.now() - ctrl.aimT;
    if (age > 700 && !ctrl.showHover) return;
    const ctx = this.ctx;
    const sc = this.cam.s;
    const x = this.sx(ctrl.aim.x);
    const y = this.sy(ctrl.aim.y);
    const r = Math.max(8, sc * 0.7);
    ctx.globalAlpha = ctrl.showHover ? 1 : Math.max(0, 1 - age / 700);
    for (const [col, w] of [
      ['rgba(0,0,0,0.7)', 4],
      [PLAYER_COLORS[you] ?? '#fff', 2],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r * 1.4, y);
      ctx.lineTo(x - r * 0.4, y);
      ctx.moveTo(x + r * 0.4, y);
      ctx.lineTo(x + r * 1.4, y);
      ctx.moveTo(x, y - r * 1.4);
      ctx.lineTo(x, y - r * 0.4);
      ctx.moveTo(x, y + r * 0.4);
      ctx.lineTo(x, y + r * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/** Draws a piece preview into a small canvas (HUD "next piece"), in the player's own wall style. */
export function drawPiecePreview(c: HTMLCanvasElement, sp: SpriteSet, shape: number, rot: number, color: number, faction: number) {
  const ctx = c.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = c.clientWidth || 48;
  if (c.width !== Math.round(size * dpr)) {
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  if (shape < 0) return;
  const cells = pieceCells(shape, rot);
  const xs = cells.map((c2) => c2[0]);
  const ys = cells.map((c2) => c2[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;
  const cs = Math.floor(Math.min((size - 8) / Math.max(w, h), 16));
  const ox = Math.round((size - w * cs) / 2);
  const oy = Math.round((size - h * cs) / 2);
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const walls = sp.walls(faction, color);
  for (const [x, y] of cells) {
    const mask = (set.has(`${x},${y - 1}`) ? 1 : 0) | (set.has(`${x + 1},${y}`) ? 2 : 0) | (set.has(`${x},${y + 1}`) ? 4 : 0) | (set.has(`${x - 1},${y}`) ? 8 : 0);
    ctx.drawImage(walls[mask], ox + (x - minX) * cs, oy + (y - minY) * cs, cs, cs);
  }
}

export { TS };

import { PLAYER_COLORS } from '../shared/constants';
import { GameEvent, GameState } from '../shared/types';

type Kind = 'star' | 'debris' | 'smoke' | 'drop' | 'ring' | 'text' | 'spark' | 'flash';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: string;
  text?: string;
}

const DEBRIS: Record<string, string[]> = {
  wall: ['#9a9a9a', '#c8c8c8', '#6a6a6a'],
  ground: ['#6b4420', '#8a5a2a', '#3a2410'],
  cannon: ['#2a2a2a', '#555555', '#ffb347'],
  ship: ['#6b3f1d', '#a0662e', '#f2e6c8'],
  castle: ['#b3b3b3', '#8e8e8e'],
  grunt: ['#4b5a2a', '#2e3a18', '#ffb347'],
  dud: ['#6b4420', '#8a5a2a'],
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Short-lived visual flourishes, in tile coordinates. */
export class Effects {
  parts: Particle[] = [];
  shake = 0;

  private add(p: Partial<Particle> & { kind: Kind; x: number; y: number; max: number }) {
    this.parts.push({ z: 0, vx: 0, vy: 0, vz: 0, size: 1, color: '#fff', life: 0, ...p });
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
  }

  explosion(x: number, y: number, kind: string, big = false) {
    this.add({ kind: 'star', x, y, max: big ? 0.5 : 0.35, size: big ? 1.6 : 1.1, color: '#ff4040' });
    const cols = DEBRIS[kind] ?? DEBRIS.ground;
    const n = big ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(1, big ? 4.5 : 3);
      this.add({
        kind: 'debris',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.7,
        vz: rnd(2, 5),
        max: rnd(0.5, 0.9),
        size: rnd(0.08, 0.16),
        color: cols[i % cols.length],
      });
    }
    for (let i = 0; i < (big ? 4 : 2); i++) {
      this.add({ kind: 'smoke', x: x + rnd(-0.3, 0.3), y: y + rnd(-0.3, 0.3), vy: -0.4, max: rnd(0.8, 1.4), size: rnd(0.35, 0.6), color: '#555' });
    }
  }

  splash(x: number, y: number) {
    this.add({ kind: 'ring', x, y, max: 0.7, size: 0.9, color: '#dff0ff' });
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({ kind: 'drop', x, y, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 0.9, vz: rnd(2.5, 4.5), max: rnd(0.4, 0.7), size: 0.09, color: '#e8f6ff' });
    }
  }

  text(x: number, y: number, text: string, color: string) {
    this.add({ kind: 'text', x, y, vy: -0.9, max: 1.2, color, text, size: 1 });
  }

  sparkle(x: number, y: number, color: string, n = 10, spread = 1.2) {
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'spark', x: x + rnd(-spread, spread), y: y + rnd(-spread, spread), vy: -rnd(0.3, 1), max: rnd(0.5, 1.1), size: rnd(0.08, 0.16), color });
    }
  }

  muzzle(x: number, y: number) {
    this.add({ kind: 'flash', x, y, max: 0.15, size: 0.7, color: '#fff2a8' });
    this.add({ kind: 'smoke', x, y, vy: -0.5, max: 0.8, size: 0.35, color: '#888' });
  }

  handle(e: GameEvent, s: GameState, you: number) {
    switch (e.e) {
      case 'boom':
        if (e.kind === 'water') this.splash(e.x, e.y);
        else this.explosion(e.x, e.y, e.kind, e.kind === 'cannon' || e.kind === 'ship');
        if (e.kind === 'wall' || e.kind === 'cannon') this.shake = Math.max(this.shake, 0.12);
        break;
      case 'sink':
        this.explosion(e.x, e.y, 'ship', true);
        this.shake = Math.max(this.shake, 0.25);
        break;
      case 'fire':
        this.muzzle(e.x, e.y);
        break;
      case 'score':
        if (e.p === you || s.players.length <= 2) this.text(e.x, e.y - 0.4, `+${e.amount}`, PLAYER_COLORS[e.p] ?? '#fff');
        break;
      case 'castle': {
        const c = s.castles[e.id];
        if (c) this.sparkle(c.x + 1, c.y + 1, '#ffe066', 16);
        break;
      }
      case 'place':
        for (const i of e.cells.slice(0, 5)) this.sparkle((i % s.W) + 0.5, Math.floor(i / s.W) + 0.5, '#e8e8e8', 2, 0.4);
        break;
      case 'grunt':
        this.sparkle(e.x, e.y, '#dfe8b0', 6, 0.5);
        break;
      default:
        break;
    }
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt);
    for (const p of this.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'debris' || p.kind === 'drop') {
        p.vz -= 14 * dt;
        p.z = Math.max(0, p.z + p.vz * dt);
        if (p.z === 0) {
          p.vx *= 0.8;
          p.vy *= 0.8;
        }
      }
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
  }

  draw(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
    for (const p of this.parts) {
      const t = p.life / p.max;
      const x = sx(p.x);
      const y = sy(p.y) - p.z * scale * 0.25;
      switch (p.kind) {
        case 'star': {
          const r = scale * p.size * (0.4 + t * 0.9);
          ctx.save();
          ctx.translate(x, y);
          ctx.globalAlpha = 1 - t * 0.8;
          for (const [col, k] of [
            ['#ff3030', 1],
            ['#ffffff', 0.55],
          ] as const) {
            ctx.fillStyle = col;
            ctx.beginPath();
            for (let i = 0; i < 16; i++) {
              const a = (i / 16) * Math.PI * 2 + t;
              const rr = (i % 2 ? r * 0.35 : r) * k;
              ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            }
            ctx.fill();
          }
          ctx.restore();
          break;
        }
        case 'flash':
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(x, y, scale * p.size * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'debris':
        case 'drop':
        case 'spark': {
          ctx.globalAlpha = p.kind === 'spark' ? 1 - t : Math.min(1, 2 - t * 2);
          ctx.fillStyle = p.color;
          const sz = Math.max(1.5, p.size * scale);
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
          break;
        }
        case 'smoke':
          ctx.globalAlpha = 0.45 * (1 - t);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(x, y, scale * p.size * (0.6 + t), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ring':
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, scale * 0.08);
          ctx.beginPath();
          ctx.ellipse(x, y, scale * p.size * (0.3 + t), scale * p.size * (0.2 + t * 0.6), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'text': {
          ctx.globalAlpha = Math.min(1, 2.5 - t * 2.5);
          const fs = Math.max(10, Math.min(18, scale * 0.7));
          ctx.font = `bold ${fs}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(p.text ?? '', x, y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text ?? '', x, y);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

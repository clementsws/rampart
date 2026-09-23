import { PLAYER_COLORS } from '../shared/constants';
import { Execution } from '../shared/types';

interface Figure {
  name: string;
  color: string;
}

const W = 320;
const H = 180;
const EACH = 4;

/** Cartoon finale for defeated commanders, drawn on a small canvas at 320x180 logical pixels. */
export class ExecutionScene {
  private t0 = performance.now();
  private raf = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly method: Execution,
    private readonly victims: Figure[],
    private readonly winner: Figure,
    private readonly onBeat: (beat: 'splash' | 'chop') => void,
  ) {
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private lastBeat = -1;

  private draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = c.clientWidth || W;
    const ch = c.clientHeight || H;
    if (c.width !== Math.round(cw * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const ctx = c.getContext('2d')!;
    const k = Math.min(cw / W, ch / H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (cw - W * k) / 2, dpr * (ch - H * k) / 2);
    const time = (performance.now() - this.t0) / 1000;
    const n = Math.max(1, this.victims.length);
    const idx = Math.floor(time / EACH) % n;
    const t = time % EACH;
    const victim = this.victims[idx] ?? { name: '???', color: '#888' };
    const beatTime = this.method === 'plank' ? 2.9 : 1.45;
    const beatId = Math.floor(time / EACH);
    if (t >= beatTime && this.lastBeat !== beatId) {
      this.lastBeat = beatId;
      this.onBeat(this.method === 'plank' ? 'splash' : 'chop');
    }
    if (this.method === 'plank') this.plank(ctx, t, time, victim);
    else this.behead(ctx, t, time, victim);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const label = this.method === 'plank' ? `${victim.name} walks the plank!` : `Off with ${victim.name}'s head!`;
    ctx.strokeText(label, W / 2, H - 10);
    ctx.fillText(label, W / 2, H - 10);
  }

  private person(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, opts: { crown?: boolean; hood?: boolean; walk?: number; noHead?: boolean; kneel?: boolean } = {}) {
    const legSwing = opts.walk ? Math.sin(opts.walk * 12) * 3 : 0;
    ctx.fillStyle = '#2a2a2a';
    if (opts.kneel) {
      ctx.fillRect(x - 5, y - 4, 10, 4);
    } else {
      ctx.fillRect(x - 3 + legSwing * 0.5, y - 8, 3, 8);
      ctx.fillRect(x + 1 - legSwing * 0.5, y - 8, 3, 8);
    }
    const bodyY = opts.kneel ? y - 14 : y - 20;
    ctx.fillStyle = color;
    ctx.fillRect(x - 5, bodyY, 11, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 3, bodyY, 3, 12);
    if (opts.noHead) return;
    const hy = bodyY - 7;
    ctx.fillStyle = opts.hood ? '#111' : '#f1c9a0';
    ctx.fillRect(x - 4, hy, 9, 8);
    if (opts.hood) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 2, hy + 3, 2, 1);
      ctx.fillRect(x + 2, hy + 3, 2, 1);
    } else {
      ctx.fillStyle = '#222';
      ctx.fillRect(x - 2, hy + 3, 1, 1);
      ctx.fillRect(x + 2, hy + 3, 1, 1);
    }
    if (opts.crown) this.crown(ctx, x - 4, hy - 5);
  }

  private crown(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(x, y + 2, 9, 3);
    ctx.fillRect(x, y, 1, 2);
    ctx.fillRect(x + 4, y, 1, 2);
    ctx.fillRect(x + 8, y, 1, 2);
  }

  private plank(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#f4a259');
    sky.addColorStop(0.6, '#f7d08a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Sea
    ctx.fillStyle = '#1f4f93';
    ctx.fillRect(0, 128, W, H - 128);
    ctx.fillStyle = '#3a78c8';
    for (let x = -20; x < W + 20; x += 16) {
      const wy = 128 + Math.sin(time * 2 + x * 0.2) * 2;
      ctx.fillRect(x + ((time * 10) % 16), wy, 9, 2);
    }
    // Shark fin
    const fx = 250 + Math.sin(time * 0.9) * 40;
    ctx.fillStyle = '#5b6b7a';
    ctx.beginPath();
    ctx.moveTo(fx, 132);
    ctx.lineTo(fx + 10, 132);
    ctx.lineTo(fx + 3, 118);
    ctx.fill();
    // Ship
    ctx.fillStyle = '#5a3216';
    ctx.beginPath();
    ctx.moveTo(0, 96);
    ctx.lineTo(150, 96);
    ctx.lineTo(128, 138);
    ctx.lineTo(0, 138);
    ctx.fill();
    ctx.fillStyle = '#7b4a24';
    ctx.fillRect(0, 92, 150, 5);
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(60, 10, 5, 84);
    ctx.fillStyle = '#f2ead6';
    ctx.fillRect(30, 20, 62, 44);
    ctx.fillStyle = '#111';
    ctx.fillRect(66, 8, 22, 12);
    // Plank
    ctx.fillStyle = '#a0662e';
    ctx.fillRect(140, 90, 90, 4);
    this.person(ctx, 95, 92, this.winner.color, { crown: true });
    ctx.fillStyle = '#ccc';
    ctx.fillRect(101, 76, 16, 2);
    // Victim walks to the end, then drops.
    let vx = 110 + Math.min(1, t / 2.4) * 110;
    let vy = 92;
    let alpha = 1;
    if (t > 2.5) {
      const ft = t - 2.5;
      vx += ft * 12;
      vy = 92 + ft * ft * 180;
      if (vy > 150) alpha = 0;
    }
    if (alpha > 0) this.person(ctx, vx, vy, v.color, { crown: true, walk: t < 2.4 ? t : 0 });
    if (t > 2.9 && t < 3.9) {
      const st = t - 2.9;
      ctx.fillStyle = `rgba(255,255,255,${1 - st})`;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ctx.fillRect(228 + Math.cos(a) * st * 30, 128 + Math.sin(a) * st * 30 + st * st * 40, 3, 3);
      }
    }
  }

  private behead(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    ctx.fillStyle = '#7a8aa0';
    ctx.fillRect(0, 0, W, H);
    // Castle wall backdrop
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(0, 40, W, 96);
    ctx.fillStyle = '#80898f';
    for (let y = 44; y < 136; y += 10) for (let x = (y / 10) % 2 ? 0 : 12; x < W; x += 24) ctx.fillRect(x, y, 22, 1);
    for (let x = 0; x < W; x += 24) ctx.fillRect(x, 30, 14, 12);
    ctx.fillStyle = '#6b7a3a';
    ctx.fillRect(0, 136, W, H - 136);
    // Banners
    ctx.fillStyle = this.winner.color;
    ctx.fillRect(40, 50, 16, 36);
    ctx.fillRect(264, 50, 16, 36);
    // Block
    ctx.fillStyle = '#6b3f1d';
    ctx.fillRect(150, 124, 34, 14);
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(150, 124, 34, 3);
    // Victim kneels with head on the block.
    const chopped = t > 1.45;
    this.person(ctx, 196, 138, v.color, { kneel: true, noHead: true });
    if (!chopped) {
      ctx.fillStyle = '#f1c9a0';
      ctx.fillRect(176, 114, 9, 9);
      this.crown(ctx, 176, 109);
    } else {
      // Head (with crown) pops off and bounces away.
      const ht = t - 1.45;
      const hx = 180 - ht * 40;
      let hy = 118 - ht * 60 + ht * ht * 90;
      if (hy > 128) hy = 128 - Math.abs(Math.sin(ht * 6)) * 6 / (1 + ht);
      ctx.save();
      ctx.translate(Math.max(110, hx), hy);
      ctx.rotate(-ht * 5);
      ctx.fillStyle = '#f1c9a0';
      ctx.fillRect(-4, -4, 9, 9);
      ctx.fillStyle = '#222';
      ctx.fillRect(-2, -1, 1, 1);
      ctx.fillRect(2, -1, 1, 1);
      ctx.restore();
      const cx = 176 + ht * 50;
      const cy = 100 - ht * 80 + ht * ht * 120;
      this.crown(ctx, cx, Math.min(cy, 132));
      if (ht < 0.5) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText('CHOP!', 166, 80);
        ctx.fillText('CHOP!', 166, 80);
      }
    }
    // Executioner with axe.
    this.person(ctx, 140, 138, this.winner.color, { hood: true });
    let a: number;
    if (t < 1.2) a = -0.4 - (t / 1.2) * 1.8;
    else if (t < 1.45) a = -2.2 + ((t - 1.2) / 0.25) * 2.6;
    else a = 0.4;
    ctx.save();
    ctx.translate(146, 112);
    ctx.rotate(a);
    ctx.fillStyle = '#5a3216';
    ctx.fillRect(0, -2, 34, 4);
    ctx.fillStyle = '#c8ccd2';
    ctx.beginPath();
    ctx.moveTo(26, -2);
    ctx.lineTo(36, -12);
    ctx.lineTo(40, 2);
    ctx.lineTo(28, 2);
    ctx.fill();
    ctx.restore();
    void time;
  }
}

export function figureFor(name: string, id: number): Figure {
  return { name, color: PLAYER_COLORS[id] ?? '#888' };
}

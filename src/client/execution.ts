import { PLAYER_COLORS } from '../shared/constants';
import { Execution } from '../shared/types';

export type Hat = 'crown' | 'tricorn';

export interface Figure {
  name: string;
  color: string;
  hat: Hat;
}

export type Beat = 'splash' | 'chop' | 'splat' | 'whoosh' | 'ding' | 'roar' | 'burp' | 'jingle' | 'honk';

const W = 320;
const H = 180;

interface Fate {
  /** Menu label and emoji. */
  label: string;
  icon: string;
  /** Seconds per victim. */
  dur: number;
  beats: [number, Beat][];
  caption: (name: string) => string;
  quips: string[];
}

/** The menu of medieval punishments. Scenes are drawn below. */
export const FATES: Record<Execution, Fate> = {
  tomatoes: {
    label: 'Tomatoes',
    icon: '🍅',
    dur: 4.6,
    beats: [
      [1.05, 'splat'],
      [1.55, 'splat'],
      [2.0, 'splat'],
      [2.4, 'splat'],
      [2.75, 'splat'],
      [3.1, 'splat'],
      [3.6, 'splat'],
    ],
    caption: (n) => `${n} is pelted with tomatoes!`,
    quips: ['The peasants have excellent aim.', 'Ketchup was invented that very day.', 'Rotten Tomatoes rating: 0%.', 'A cabbage, for good measure.'],
  },
  plank: {
    label: 'Walk the plank',
    icon: '🏴‍☠️',
    dur: 4,
    beats: [[2.9, 'splash']],
    caption: (n) => `${n} walks the plank!`,
    quips: ['The sharks send their thanks.', 'Should have taken swimming lessons.', 'Mind the gap!', 'Glub glub.'],
  },
  behead: {
    label: 'Beheading',
    icon: '🪓',
    dur: 4,
    beats: [[1.45, 'chop']],
    caption: (n) => `Off with ${n}'s head!`,
    quips: ['Well, that is one way to lose your head.', 'Heads will roll. Literally.', 'Chin up! Oh… never mind.', 'A cut above the rest.'],
  },
  trebuchet: {
    label: 'Trebuchet',
    icon: '🪨',
    dur: 4.6,
    beats: [
      [1.05, 'whoosh'],
      [3.55, 'ding'],
    ],
    caption: (n) => `${n} is launched by trebuchet!`,
    quips: ['Frequent flyer miles: earned.', 'Last seen somewhere over France.', 'Physics wins again.', 'Ninety kilos of payload. Mostly ego.'],
  },
  dragon: {
    label: 'Dragon lunch',
    icon: '🐉',
    dur: 4.8,
    beats: [
      [0.3, 'roar'],
      [1.6, 'chop'],
      [3.2, 'burp'],
    ],
    caption: (n) => `${n} is fed to the dragon!`,
    quips: ['Tastes like chicken, apparently.', 'The dragon rates it two stars.', 'Pardon me!', 'Crunchy on the outside.'],
  },
  dunk: {
    label: 'Ducking stool',
    icon: '🦆',
    dur: 4.8,
    beats: [
      [1.2, 'splash'],
      [2.2, 'splash'],
      [3.2, 'splash'],
      [4.0, 'honk'],
    ],
    caption: (n) => `${n} gets the ducking stool!`,
    quips: ['Floats! Must be a witch.', 'Bath day came early this year.', 'A duck has claimed the throne.', 'Refreshing!'],
  },
  jester: {
    label: 'Court jester',
    icon: '🤡',
    dur: 4.6,
    beats: [
      [0.4, 'jingle'],
      [1.5, 'jingle'],
      [2.6, 'jingle'],
      [3.35, 'splat'],
      [3.7, 'honk'],
    ],
    caption: (n) => `${n} is the new court jester!`,
    quips: ['Honk honk, your majesty.', 'Worst career change ever.', 'The bells! The bells!', 'Juggling is harder than conquest.'],
  },
};

/** Deterministic noise so scenes look the same every loop. */
const rnd = (a: number, b = 0) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', italic = false) {
  ctx.font = `${italic ? 'italic ' : ''}bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(2, size / 4);
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Cartoon finale for defeated commanders, drawn on a small canvas at 320x180 logical pixels. */
export class ExecutionScene {
  private t0 = performance.now();
  private raf = 0;
  private lastBeat = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly method: Execution,
    private readonly victims: Figure[],
    private readonly winner: Figure,
    private readonly onBeat: (beat: Beat) => void,
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
    ctx.setTransform(dpr * k, 0, 0, dpr * k, (dpr * (cw - W * k)) / 2, (dpr * (ch - H * k)) / 2);
    const fate = FATES[this.method] ?? FATES.behead;
    const time = (performance.now() - this.t0) / 1000;
    const n = Math.max(1, this.victims.length);
    const cycle = Math.floor(time / fate.dur);
    const idx = cycle % n;
    const t = time % fate.dur;
    const victim = this.victims[idx] ?? { name: '???', color: '#888', hat: 'crown' };
    for (const [bt, beat] of fate.beats) {
      const key = `${cycle}:${bt}`;
      if (t >= bt && !this.lastBeat.has(key)) {
        this.lastBeat.add(key);
        this.onBeat(beat);
      }
    }
    if (this.lastBeat.size > 64) this.lastBeat.clear();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    switch (this.method) {
      case 'plank':
        this.plank(ctx, t, time, victim);
        break;
      case 'tomatoes':
        this.tomatoes(ctx, t, time, victim, cycle);
        break;
      case 'trebuchet':
        this.trebuchet(ctx, t, time, victim);
        break;
      case 'dragon':
        this.dragon(ctx, t, time, victim);
        break;
      case 'dunk':
        this.dunk(ctx, t, time, victim);
        break;
      case 'jester':
        this.jester(ctx, t, time, victim);
        break;
      default:
        this.behead(ctx, t, victim);
    }
    ctx.restore();
    text(ctx, fate.caption(victim.name), W / 2, H - 20, 12);
    text(ctx, fate.quips[(idx + cycle) % fate.quips.length], W / 2, H - 6, 9, '#ffd65a', true);
  }

  // ------------------------------------------------------------ figures

  private person(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    opts: { hat?: Hat | 'hood' | 'jester'; walk?: number; noHead?: boolean; kneel?: boolean; laugh?: number } = {},
  ) {
    const legSwing = opts.walk ? Math.sin(opts.walk * 12) * 3 : 0;
    ctx.fillStyle = '#2a2a2a';
    if (opts.kneel) {
      ctx.fillRect(x - 5, y - 4, 10, 4);
    } else {
      ctx.fillRect(x - 3 + legSwing * 0.5, y - 8, 3, 8);
      ctx.fillRect(x + 1 - legSwing * 0.5, y - 8, 3, 8);
    }
    const bob = opts.laugh ? Math.abs(Math.sin(opts.laugh * 14)) * 1.5 : 0;
    const bodyY = (opts.kneel ? y - 14 : y - 20) - bob;
    ctx.fillStyle = color;
    ctx.fillRect(x - 5, bodyY, 11, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 3, bodyY, 3, 12);
    if (opts.noHead) return;
    this.head(ctx, x, bodyY - 7, opts.hat === 'hood', !!opts.laugh);
    if (opts.hat === 'crown') this.crown(ctx, x - 4, bodyY - 12);
    else if (opts.hat === 'tricorn') this.tricorn(ctx, x - 6, bodyY - 11);
    else if (opts.hat === 'jester') this.jesterHat(ctx, x, bodyY - 7, color, opts.laugh ?? 0);
  }

  private head(ctx: CanvasRenderingContext2D, x: number, hy: number, hood = false, laughing = false) {
    ctx.fillStyle = hood ? '#111' : '#f1c9a0';
    ctx.fillRect(x - 4, hy, 9, 8);
    ctx.fillStyle = hood ? '#fff' : '#222';
    if (hood) {
      ctx.fillRect(x - 2, hy + 3, 2, 1);
      ctx.fillRect(x + 2, hy + 3, 2, 1);
    } else {
      ctx.fillRect(x - 2, hy + 3, 1, 1);
      ctx.fillRect(x + 2, hy + 3, 1, 1);
      if (laughing) {
        ctx.fillStyle = '#7a1a1a';
        ctx.fillRect(x - 1, hy + 5, 3, 2);
      }
    }
  }

  private crown(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(x, y + 2, 9, 3);
    ctx.fillRect(x, y, 1, 2);
    ctx.fillRect(x + 4, y, 1, 2);
    ctx.fillRect(x + 8, y, 1, 2);
  }

  private tricorn(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#16161a';
    ctx.fillRect(x, y + 3, 13, 2);
    ctx.fillRect(x + 2, y, 9, 4);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(x + 5, y + 1, 3, 2);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(x, y + 4, 13, 1);
  }

  private jesterHat(ctx: CanvasRenderingContext2D, x: number, hy: number, color: string, t: number) {
    const flop = Math.sin(t * 10) * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 4, hy + 1);
    ctx.lineTo(x - 11, hy - 6 + flop);
    ctx.lineTo(x, hy - 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.moveTo(x + 5, hy + 1);
    ctx.lineTo(x + 12, hy - 6 - flop);
    ctx.lineTo(x, hy - 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(x - 12, hy - 7 + flop, 3, 3);
    ctx.fillStyle = color;
    ctx.fillRect(x + 11, hy - 7 - flop, 3, 3);
  }

  // -------------------------------------------------------------- scenes

  private plank(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#f4a259');
    sky.addColorStop(0.6, '#f7d08a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f4f93';
    ctx.fillRect(0, 128, W, H - 128);
    ctx.fillStyle = '#3a78c8';
    for (let x = -20; x < W + 20; x += 16) {
      const wy = 128 + Math.sin(time * 2 + x * 0.2) * 2;
      ctx.fillRect(x + ((time * 10) % 16), wy, 9, 2);
    }
    const fx = 250 + Math.sin(time * 0.9) * 40;
    ctx.fillStyle = '#5b6b7a';
    ctx.beginPath();
    ctx.moveTo(fx, 132);
    ctx.lineTo(fx + 10, 132);
    ctx.lineTo(fx + 3, 118);
    ctx.fill();
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
    ctx.fillStyle = '#a0662e';
    ctx.fillRect(140, 90, 90, 4);
    this.person(ctx, 95, 92, this.winner.color, { hat: this.winner.hat });
    ctx.fillStyle = '#ccc';
    ctx.fillRect(101, 76, 16, 2);
    let vx = 110 + Math.min(1, t / 2.4) * 110;
    let vy = 92;
    let alpha = 1;
    if (t > 2.5) {
      const ft = t - 2.5;
      vx += ft * 12;
      vy = 92 + ft * ft * 180;
      if (vy > 150) alpha = 0;
    }
    if (alpha > 0) this.person(ctx, vx, vy, v.color, { hat: v.hat, walk: t < 2.4 ? t : 0 });
    if (t > 2.9 && t < 3.9) {
      const st = t - 2.9;
      ctx.fillStyle = `rgba(255,255,255,${1 - st})`;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ctx.fillRect(228 + Math.cos(a) * st * 30, 128 + Math.sin(a) * st * 30 + st * st * 40, 3, 3);
      }
    }
  }

  private behead(ctx: CanvasRenderingContext2D, t: number, v: Figure) {
    ctx.fillStyle = '#7a8aa0';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(0, 40, W, 96);
    ctx.fillStyle = '#80898f';
    for (let y = 44; y < 136; y += 10) for (let x = (y / 10) % 2 ? 0 : 12; x < W; x += 24) ctx.fillRect(x, y, 22, 1);
    for (let x = 0; x < W; x += 24) ctx.fillRect(x, 30, 14, 12);
    ctx.fillStyle = '#6b7a3a';
    ctx.fillRect(0, 136, W, H - 136);
    ctx.fillStyle = this.winner.color;
    ctx.fillRect(40, 50, 16, 36);
    ctx.fillRect(264, 50, 16, 36);
    ctx.fillStyle = '#6b3f1d';
    ctx.fillRect(150, 124, 34, 14);
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(150, 124, 34, 3);
    const chopped = t > 1.45;
    this.person(ctx, 196, 138, v.color, { kneel: true, noHead: true });
    if (!chopped) {
      ctx.fillStyle = '#f1c9a0';
      ctx.fillRect(176, 114, 9, 9);
      if (v.hat === 'tricorn') this.tricorn(ctx, 174, 109);
      else this.crown(ctx, 176, 109);
    } else {
      const ht = t - 1.45;
      const hx = 180 - ht * 40;
      let hy = 118 - ht * 60 + ht * ht * 90;
      if (hy > 128) hy = 128 - (Math.abs(Math.sin(ht * 6)) * 6) / (1 + ht);
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
      if (v.hat === 'tricorn') this.tricorn(ctx, cx, Math.min(cy, 131));
      else this.crown(ctx, cx, Math.min(cy, 132));
      if (ht < 0.5) text(ctx, 'CHOP!', 166, 80, 18);
    }
    this.person(ctx, 140, 138, this.winner.color, { hat: 'hood' });
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
  }

  /** Village square: the victim in the stocks, the crowd with baskets of tomatoes. */
  private tomatoes(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure, cycle: number) {
    const sky = ctx.createLinearGradient(0, 0, 0, 120);
    sky.addColorStop(0, '#8ec5ff');
    sky.addColorStop(1, '#dff0ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Timber-framed houses.
    for (let i = 0; i < 5; i++) {
      const hx = i * 68 - 6;
      const hh = 52 + (i % 2) * 12;
      ctx.fillStyle = '#efe2c4';
      ctx.fillRect(hx, 118 - hh, 58, hh);
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(hx, 118 - hh, 58, 3);
      for (let bx = hx; bx < hx + 58; bx += 14) ctx.fillRect(bx, 118 - hh, 3, hh);
      ctx.fillRect(hx, 118 - hh / 2, 58, 3);
      ctx.fillStyle = i % 2 ? '#9b3b2a' : '#7a4a2a';
      ctx.beginPath();
      ctx.moveTo(hx - 5, 118 - hh);
      ctx.lineTo(hx + 29, 118 - hh - 26);
      ctx.lineTo(hx + 63, 118 - hh);
      ctx.fill();
      ctx.fillStyle = '#3a5a8a';
      ctx.fillRect(hx + 20, 118 - hh + 10, 8, 8);
    }
    // Cobbles.
    ctx.fillStyle = '#8b7d6b';
    ctx.fillRect(0, 118, W, H - 118);
    ctx.fillStyle = '#76695a';
    for (let y = 122; y < H; y += 6) for (let x = ((y / 6) % 2) * 6; x < W; x += 12) ctx.fillRect(x, y, 8, 3);
    // The stocks.
    const px = 214;
    ctx.fillStyle = '#5e3b1c';
    ctx.fillRect(px - 2, 92, 5, 48);
    this.person(ctx, px, 140, v.color, { noHead: true });
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(px - 24, 96, 49, 9);
    ctx.fillStyle = '#6a4020';
    ctx.fillRect(px - 24, 100, 49, 1);
    this.head(ctx, px, 93);
    ctx.fillStyle = '#f1c9a0';
    ctx.fillRect(px - 18, 98, 4, 4);
    ctx.fillRect(px + 15, 98, 4, 4);
    if (v.hat === 'tricorn') this.tricorn(ctx, px - 6, 88);
    else this.crown(ctx, px - 4, 88);
    // Throws: each lands on a fixed time; splats pile up.
    const throws = FATES.tomatoes.beats.map(([bt], i) => {
      const from = 60 + rnd(i, cycle) * 90;
      return { land: bt, x0: from, y0: 150, x1: px - 10 + rnd(i + 9, cycle) * 22, y1: 90 + rnd(i + 3, cycle) * 14, cabbage: i === 6 };
    });
    for (const th of throws) {
      const f = (t - (th.land - 0.5)) / 0.5;
      if (f < 0) continue;
      if (f < 1) {
        const x = th.x0 + (th.x1 - th.x0) * f;
        const y = th.y0 + (th.y1 - th.y0) * f - Math.sin(Math.PI * f) * 40;
        ctx.fillStyle = th.cabbage ? '#6fbf3a' : '#e0302a';
        ctx.beginPath();
        ctx.arc(x, y, th.cabbage ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = th.cabbage ? '#6fbf3a' : '#d42a24';
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.fillRect(th.x1 + Math.cos(a) * 3 - 1, th.y1 + Math.sin(a) * 2 - 1, 3, 3);
        }
        ctx.fillRect(th.x1 - 2, th.y1 - 2, 5, 5);
        if (f < 1.8) text(ctx, th.cabbage ? 'THUD!' : 'SPLAT!', th.x1 + 26, th.y1 - 10 - (f - 1) * 10, 10, th.cabbage ? '#b8f07a' : '#ff6a5a');
      }
    }
    // The crowd, arms up when throwing.
    for (let i = 0; i < 4; i++) {
      const cx = 52 + i * 34;
      const cloth = ['#5a4a3a', '#4a5a3a', '#6a3a3a', '#3a4a6a'][i];
      const throwing = throws.some((th) => Math.abs(th.x0 - cx) < 20 && t > th.land - 0.6 && t < th.land - 0.35);
      ctx.fillStyle = cloth;
      ctx.fillRect(cx - 8, 150, 16, 30);
      ctx.fillStyle = '#e8b890';
      ctx.fillRect(cx - 5, 140, 10, 10);
      ctx.fillStyle = cloth;
      if (throwing) ctx.fillRect(cx + 6, 134, 4, 18);
      else ctx.fillRect(cx + 7, 152, 4, 12);
    }
    // The winner, in stitches.
    this.person(ctx, 280, 140, this.winner.color, { hat: this.winner.hat, laugh: time });
    if (Math.sin(time * 6) > 0) text(ctx, 'HA HA!', 280, 104, 9, '#ffe066');
  }

  /** Loaded into a trebuchet's sling and flung over the horizon. */
  private trebuchet(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#5c7fc8');
    sky.addColorStop(0.7, '#f5c6a0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6f9a5a';
    ctx.beginPath();
    ctx.moveTo(0, 120);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, 112 + Math.sin(x * 0.03) * 8);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
    // Distant castle.
    ctx.fillStyle = '#8a8fa0';
    ctx.fillRect(250, 88, 50, 26);
    for (let x = 250; x < 300; x += 8) ctx.fillRect(x, 84, 5, 4);
    ctx.fillStyle = '#4e8a3e';
    ctx.fillRect(0, 140, W, H - 140);
    // Frame.
    const ax = 96;
    const ay = 100;
    ctx.fillStyle = '#6a4020';
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#6a4020';
    ctx.beginPath();
    ctx.moveTo(76, 142);
    ctx.lineTo(ax, ay);
    ctx.lineTo(116, 142);
    ctx.moveTo(64, 142);
    ctx.lineTo(128, 142);
    ctx.stroke();
    // Arm: rests pointing down-left, then swings over the top.
    const swing = ease((t - 1.0) / 0.45);
    const a = Math.PI * (0.84 + swing * 0.84);
    const L = 54;
    const ex = ax + Math.cos(a) * L;
    const ey = ay + Math.sin(a) * L;
    const wx = ax - Math.cos(a) * 20;
    const wy = ay - Math.sin(a) * 20;
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#4a4a52';
    ctx.fillRect(wx - 8, wy, 16, 14);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(ax - 2, ay - 2, 4, 4);
    // Victim in the sling, then airborne.
    const release = 1.45;
    if (t < release) {
      ctx.save();
      ctx.translate(ex, ey + 4);
      ctx.rotate(swing * 2);
      this.person(ctx, 0, 10, v.color, { hat: v.hat, kneel: true });
      ctx.restore();
      if (t > 0.5 && t < 1.05) text(ctx, 'Hold still…', ex + 8, ey - 26, 9);
    } else {
      // Off into the distance: the victim shrinks as they sail towards the horizon.
      const ft = t - release;
      const rx = ax + Math.cos(Math.PI * 1.68) * L;
      const ry = ay + Math.sin(Math.PI * 1.68) * L;
      const path = (f: number) => ({ x: rx + f * 86, y: ry - f * 36 + f * f * 9, k: 1 / (1 + f * 0.9) });
      const p = path(ft);
      if (ft < 2.1) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(p.k, p.k);
        ctx.rotate(ft * 8);
        this.person(ctx, 0, 10, v.color, { hat: v.hat });
        ctx.restore();
      }
      const s = 'AAAAaaaa…';
      for (let i = 0; i < s.length; i++) {
        const lag = 0.12 + i * 0.1;
        if (ft < lag) continue;
        const q = path(ft - lag);
        text(ctx, s[i], q.x - 6, q.y + 22 * q.k, Math.max(5, 12 * q.k));
      }
      if (t > 3.55) {
        // A twinkle as they disappear into the distance.
        const tw = Math.max(0, 1 - (t - 3.55) * 1.2);
        ctx.fillStyle = `rgba(255,255,255,${tw})`;
        const sx = 298;
        const sy = 16;
        const r = 2 + tw * 5;
        ctx.fillRect(sx - r, sy - 1, r * 2, 2);
        ctx.fillRect(sx - 1, sy - r, 2, r * 2);
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
      }
    }
    // The winner cuts the rope.
    this.person(ctx, 146, 142, this.winner.color, { hat: this.winner.hat, laugh: t > 1.2 ? time : 0 });
    ctx.fillStyle = '#c8ccd2';
    ctx.fillRect(t < 1.0 ? 136 : 132, 124, 6, 2);
    if (t > 0.95 && t < 1.4) text(ctx, 'FIRE!', 150, 100, 12, '#ffe066');
  }

  /** Tied to a stake on the rocks; a dragon swoops in for lunch. */
  private dragon(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#3b2a5a');
    sky.addColorStop(0.75, '#e08a5a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2e2a3e';
    ctx.beginPath();
    ctx.moveTo(0, 130);
    ctx.lineTo(40, 70);
    ctx.lineTo(90, 120);
    ctx.lineTo(150, 60);
    ctx.lineTo(210, 120);
    ctx.lineTo(260, 80);
    ctx.lineTo(W, 130);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
    ctx.fillStyle = '#5a5348';
    ctx.fillRect(0, 138, W, H - 138);
    ctx.fillStyle = '#6e665a';
    ctx.beginPath();
    ctx.moveTo(180, 140);
    ctx.lineTo(196, 124);
    ctx.lineTo(230, 122);
    ctx.lineTo(244, 140);
    ctx.fill();
    // Stake with the victim (until lunch).
    ctx.fillStyle = '#5e3b1c';
    ctx.fillRect(210, 88, 4, 36);
    const eaten = t > 1.6;
    if (!eaten) {
      this.person(ctx, 212, 124, v.color, { hat: v.hat });
      ctx.fillStyle = '#c9a26a';
      ctx.fillRect(206, 108, 13, 2);
      ctx.fillRect(206, 114, 13, 2);
      if (t > 0.6 && t < 1.4) text(ctx, 'HELP!', 222, 80, 10);
    } else {
      ctx.fillStyle = '#c9a26a';
      ctx.fillRect(214, 110, 5, 2);
      ctx.fillRect(203, 116, 6, 2);
    }
    // Dragon flight path: swoop down to the stake, then climb away and hover.
    let dx: number;
    let dy: number;
    if (t < 1.6) {
      const f = ease(t / 1.6);
      dx = -70 + f * 285;
      dy = 20 + Math.sin(f * Math.PI * 0.95) * 90;
    } else {
      const f = ease((t - 1.6) / 1.0);
      dx = 215 + f * 25;
      dy = 104 - f * 54 + Math.sin(time * 3) * 3;
    }
    const flap = Math.sin(time * 12);
    ctx.save();
    ctx.translate(dx, dy);
    // Tail.
    ctx.strokeStyle = '#2f7a34';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.quadraticCurveTo(-34, 10 + flap * 3, -48, -4);
    ctx.stroke();
    ctx.fillStyle = '#2f7a34';
    ctx.beginPath();
    ctx.moveTo(-48, -4);
    ctx.lineTo(-56, -10);
    ctx.lineTo(-52, 2);
    ctx.fill();
    // Wings.
    ctx.fillStyle = '#6fbf5a';
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(-24, -30 * flap - 6);
    ctx.lineTo(8, -8);
    ctx.fill();
    // Body and neck.
    ctx.fillStyle = '#3f9a44';
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8d88a';
    ctx.fillRect(-10, 4, 20, 4);
    ctx.fillStyle = '#3f9a44';
    ctx.fillRect(12, -12, 8, 14);
    // Head with a big jaw.
    const chomp = t > 1.35 && t < 1.8 ? Math.abs(Math.sin((t - 1.35) * 20)) * 6 : 0;
    const burp = t > 3.1 && t < 3.6;
    const jaw = burp ? 7 : chomp;
    ctx.fillRect(14, -20, 18, 9);
    ctx.fillStyle = '#2f7a34';
    ctx.fillRect(16, -11 + jaw * 0.3, 16, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(22, -12, 2, 2);
    ctx.fillRect(27, -12, 2, 2);
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(18, -18, 3, 3);
    ctx.fillStyle = '#111';
    ctx.fillRect(19, -17, 1, 2);
    ctx.fillStyle = '#e04a2a';
    ctx.fillRect(15, -24, 3, 4);
    ctx.fillRect(20, -25, 3, 5);
    // Wing near side.
    ctx.fillStyle = '#58ad4c';
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(-16, -34 * flap);
    ctx.lineTo(12, -4);
    ctx.fill();
    ctx.restore();
    if (t > 1.55 && t < 2.1) text(ctx, 'GULP!', dx + 30, dy - 30, 14, '#ffe066');
    if (burp || (t > 3.1 && t < 4.4)) {
      // Burp: a smoke ring, and the victim's hat pops out.
      const bt = t - 3.1;
      ctx.strokeStyle = `rgba(220,220,220,${Math.max(0, 1 - bt)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(dx + 40 + bt * 20, dy - 16, 4 + bt * 8, 3 + bt * 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      const hx = dx + 36 + bt * 40;
      const hy = Math.min(134, dy - 16 - bt * 50 + bt * bt * 80);
      if (v.hat === 'tricorn') this.tricorn(ctx, hx, hy);
      else this.crown(ctx, hx, hy);
      if (bt < 0.8) text(ctx, 'BURP!', dx + 44, dy - 40, 12);
    }
    this.person(ctx, 50, 140, this.winner.color, { hat: this.winner.hat, laugh: t > 1.8 ? time : 0 });
    if (t < 1.4) {
      ctx.fillStyle = this.winner.color;
      ctx.fillRect(55, 112, 12, 3);
    }
  }

  /** Strapped to a ducking stool and dunked in the village pond. */
  private dunk(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#9fd0ff');
    sky.addColorStop(1, '#e8f6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#7fb85a';
    ctx.fillRect(0, 100, W, 80);
    // Pond.
    const water = 132;
    ctx.fillStyle = '#2f6fb8';
    ctx.beginPath();
    ctx.ellipse(236, 146, 98, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a9ae0';
    for (let k = 0; k < 6; k++) ctx.fillRect(170 + k * 22 + Math.sin(time * 2 + k) * 3, 140 + (k % 3) * 6, 10, 2);
    // Reeds.
    ctx.fillStyle = '#3f7a2a';
    for (const rx of [140, 146, 300, 306, 312]) ctx.fillRect(rx, 118 + (rx % 4), 2, 20);
    ctx.fillStyle = '#6a4020';
    for (const rx of [140, 306]) ctx.fillRect(rx - 1, 114, 4, 8);
    // Beam angle: the chair end goes up, then plunges three times.
    let b = -0.28;
    for (const dt of [1.0, 2.0, 3.0]) {
      const f = (t - dt) / 0.8;
      if (f > 0 && f < 1) b = -0.28 + Math.sin(Math.PI * f) * 0.62;
    }
    const pvx = 150;
    const pvy = 104;
    ctx.fillStyle = '#5e3b1c';
    ctx.fillRect(pvx - 3, pvy, 6, 36);
    const Lc = 110;
    const Ls = 48;
    const cx = pvx + Math.cos(b) * Lc;
    const cy = pvy + Math.sin(b) * Lc;
    const sx = pvx - Math.cos(b) * Ls;
    const sy = pvy - Math.sin(b) * Ls;
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    // Chair with the victim (below the surface is hidden by redrawing the water).
    ctx.fillStyle = '#6a4020';
    ctx.fillRect(cx - 7, cy, 14, 4);
    ctx.fillRect(cx + 5, cy - 12, 3, 16);
    const duck = t > 3.8;
    this.person(ctx, cx - 1, cy + 4, v.color, { hat: duck ? undefined : v.hat, kneel: true });
    if (duck) {
      // A duck has taken the crown's place.
      const dy = cy - 20;
      ctx.fillStyle = '#ffd23a';
      ctx.fillRect(cx - 5, dy, 10, 6);
      ctx.fillRect(cx + 2, dy - 5, 5, 5);
      ctx.fillStyle = '#ff8a1f';
      ctx.fillRect(cx + 7, dy - 3, 3, 2);
      ctx.fillStyle = '#111';
      ctx.fillRect(cx + 4, dy - 4, 1, 1);
      if (t > 4.0) text(ctx, 'Quack.', cx + 22, dy - 8, 10);
    }
    if (cy + 4 > water) {
      ctx.fillStyle = '#2f6fb8';
      ctx.fillRect(cx - 16, water, 32, cy + 10 - water);
    }
    // Splashes and dripping.
    for (const dt of [1.0, 2.0, 3.0]) {
      const st = t - (dt + 0.2);
      if (st > 0 && st < 0.7) {
        ctx.fillStyle = `rgba(255,255,255,${1 - st / 0.7})`;
        for (let i = 0; i < 8; i++) {
          const a = Math.PI + (i / 7) * Math.PI;
          ctx.fillRect(cx + Math.cos(a) * st * 36, water + Math.sin(a) * st * 30 + st * st * 50, 3, 3);
        }
        if (st < 0.5) text(ctx, 'SPLOOSH!', cx, 90, 12, '#cfe8ff');
      }
    }
    // The winner leans on the short end.
    this.person(ctx, sx - 6, 140, this.winner.color, { hat: this.winner.hat, laugh: t > 1 ? time : 0 });
    ctx.fillStyle = this.winner.color;
    ctx.fillRect(sx - 4, Math.min(sy, 122), 4, 2);
  }

  /** Demoted to court jester: juggling for the new ruler's amusement. */
  private jester(ctx: CanvasRenderingContext2D, t: number, time: number, v: Figure) {
    ctx.fillStyle = '#6e6a78';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#5e5a68';
    for (let y = 6; y < 130; y += 12) for (let x = (y / 12) % 2 ? 0 : 14; x < W; x += 28) ctx.fillRect(x, y, 26, 1);
    // Banners in the new ruler's colour.
    for (const bx of [30, 120, 210, 290]) {
      ctx.fillStyle = this.winner.color;
      ctx.fillRect(bx - 8, 14, 16, 40);
      ctx.beginPath();
      ctx.moveTo(bx - 8, 54);
      ctx.lineTo(bx, 62);
      ctx.lineTo(bx + 8, 54);
      ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.fillRect(bx - 3, 26, 6, 6);
    }
    // Floor and carpet.
    ctx.fillStyle = '#4a4550';
    ctx.fillRect(0, 130, W, H - 130);
    ctx.fillStyle = '#9a2a2a';
    ctx.fillRect(40, 130, 260, 10);
    // Throne.
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(38, 82, 30, 50);
    ctx.fillStyle = '#9a2a2a';
    ctx.fillRect(42, 90, 22, 34);
    this.person(ctx, 53, 132, this.winner.color, { hat: this.winner.hat, laugh: time });
    if (Math.sin(time * 5) > -0.2) text(ctx, 'HA HA HA!', 60, 72, 10, '#ffe066');
    // The jester dances and juggles.
    const hop = Math.abs(Math.sin(time * 5)) * 6;
    const jx = 200 + Math.sin(time * 1.5) * 16;
    const pied = t > 3.35;
    this.person(ctx, jx, 138 - hop, v.color, { hat: 'jester', walk: time * 0.6, laugh: pied ? 0 : time * 0.3 });
    const cols = ['#ff4d5e', '#4f7dff', '#ffd23a'];
    for (let i = 0; i < 3; i++) {
      const ph = time * 5 + (i * Math.PI * 2) / 3;
      const bx = jx + Math.cos(ph) * 10;
      const by = 96 - hop - Math.abs(Math.sin(ph)) * 22;
      ctx.fillStyle = cols[i];
      ctx.fillRect(bx - 2, by - 2, 4, 4);
    }
    // A custard pie to finish.
    if (t > 2.9) {
      const f = clamp01((t - 2.9) / 0.45);
      const px = 70 + (jx - 70) * f;
      const py = 100 - Math.sin(Math.PI * f) * 30 + (112 - hop - 100) * f;
      if (f < 1) {
        ctx.fillStyle = '#f6efd8';
        ctx.fillRect(px - 5, py - 2, 10, 4);
        ctx.fillStyle = '#c9a26a';
        ctx.fillRect(px - 5, py + 2, 10, 2);
      } else {
        ctx.fillStyle = '#f6efd8';
        ctx.fillRect(jx - 6, 108 - hop, 12, 8);
        ctx.fillRect(jx - 3, 116 - hop, 3, 4);
        if (t < 4.2) text(ctx, 'HONK!', jx + 28, 86, 12, '#ff9ad0');
      }
    }
  }
}

/** A commander as drawn in the finale. */
export function figureFor(name: string, id: number): Figure {
  return { name, color: PLAYER_COLORS[id] ?? '#888', hat: 'crown' };
}

/** The campaign's villain. */
export const PIRATE_ADMIRAL: Figure = { name: 'The Pirate Admiral', color: '#2a2a30', hat: 'tricorn' };

import { GameState, LAND } from '../shared/types';

/** Source resolution of all pixel art: one tile = TS x TS pixels. */
export const TS = 16;

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface PlayerPalette {
  main: string;
  wallLight: RGB;
  wallMid: RGB;
  wallDark: RGB;
  wallEdge: RGB;
  terrA: RGB;
  terrB: RGB;
  flag: string;
}

export const PALETTES: PlayerPalette[] = [
  { main: '#3f6df2', wallLight: hex('#d9e0ff'), wallMid: hex('#9eaef0'), wallDark: hex('#5a68c4'), wallEdge: hex('#262d6b'), terrA: hex('#1a2766'), terrB: hex('#0d1540'), flag: '#4f7dff' },
  { main: '#e0404f', wallLight: hex('#ffe0e3'), wallMid: hex('#f0a3ab'), wallDark: hex('#c45a66'), wallEdge: hex('#6b1f28'), terrA: hex('#6a1620'), terrB: hex('#380a10'), flag: '#ff4d5e' },
  { main: '#f2b705', wallLight: hex('#fff6d0'), wallMid: hex('#f0d47a'), wallDark: hex('#c49a2e'), wallEdge: hex('#664a0a'), terrA: hex('#6a5010'), terrB: hex('#3a2a06'), flag: '#ffc823' },
  { main: '#a24de8', wallLight: hex('#f1e0ff'), wallMid: hex('#c9a3f0'), wallDark: hex('#8a5ac4'), wallEdge: hex('#3d1f6b'), terrA: hex('#44186a'), terrB: hex('#240a3a'), flag: '#b565ff' },
];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Deterministic hash noise in [0,1). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  const u = s(xf);
  const v = s(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

const GRASS: RGB[] = [hex('#17641c'), hex('#1f7d22'), hex('#2a962a'), hex('#38ad33'), hex('#4cc542')];
const WATER: RGB[] = [hex('#1a4488'), hex('#2256a3'), hex('#2b66b8'), hex('#3a7bcc')];
const SHORE_DARK = hex('#7a3f17');
const SHORE = hex('#b8672a');
const SHORE_LIGHT = hex('#d98b45');
const FOAM = hex('#8fbef0');

/** Pixel-art terrain (grass hills, water, earthy river banks) for the whole map. */
export function renderTerrain(s: GameState): HTMLCanvasElement {
  const Wp = s.W * TS;
  const Hp = s.H * TS;
  const [c, ctx] = canvas(Wp, Hp);
  const img = ctx.createImageData(Wp, Hp);
  const d = img.data;
  const isWater = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= s.W || ty >= s.H || s.terrain[ty * s.W + tx] !== LAND;
  const seed = s.seed & 0xffff;
  for (let py = 0; py < Hp; py++) {
    const ty = Math.floor(py / TS);
    for (let px = 0; px < Wp; px++) {
      const tx = Math.floor(px / TS);
      const water = isWater(tx, ty);
      // Distance (in pixels) to the nearest tile of the other kind among the neighbours.
      let edge = 99;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (isWater(tx + dx, ty + dy) === water) continue;
          const rx0 = (tx + dx) * TS;
          const ry0 = (ty + dy) * TS;
          const ex = px < rx0 ? rx0 - px : px >= rx0 + TS ? px - (rx0 + TS - 1) : 0;
          const ey = py < ry0 ? ry0 - py : py >= ry0 + TS ? py - (ry0 + TS - 1) : 0;
          edge = Math.min(edge, Math.max(ex, ey) + (ex && ey ? 1 : 0));
        }
      }
      const jitter = hash(px, py, seed);
      let col: RGB;
      if (water) {
        const n = valueNoise(px / 23, py / 17, seed + 3) * 0.7 + valueNoise(px / 7, py / 5, seed + 9) * 0.3;
        let k = Math.min(3, Math.floor(n * 3.2 + jitter * 0.8));
        if (edge <= 1.5) col = FOAM;
        else {
          if (edge <= 4) k = Math.min(3, k + 1);
          col = WATER[k];
          if (jitter > 0.985) col = hex('#b9dcff');
        }
      } else {
        const wobble = hash(Math.floor(px / 2), Math.floor(py / 2), seed + 1) * 1.6;
        if (edge + wobble <= 2.2) col = SHORE_DARK;
        else if (edge + wobble <= 4.2) col = jitter > 0.5 ? SHORE : SHORE_LIGHT;
        else {
          const hill = valueNoise(px / 46, py / 46, seed + 5) * 0.75 + valueNoise(px / 13, py / 13, seed + 7) * 0.25;
          // Light from the top-left: brighter where the hill rises towards the viewer.
          const slope = valueNoise((px - 6) / 46, (py - 6) / 46, seed + 5) - valueNoise(px / 46, py / 46, seed + 5);
          const v = hill * 0.55 + 0.45 - slope * 5 + (jitter - 0.5) * 0.28;
          col = GRASS[Math.max(0, Math.min(4, Math.floor(v * 4.2)))];
        }
      }
      const o = (py * Wp + px) * 4;
      d[o] = col[0];
      d[o + 1] = col[1];
      d[o + 2] = col[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface SpriteSet {
  /** walls[player][mask] where mask bits = neighbours N(1) E(2) S(4) W(8). */
  walls: HTMLCanvasElement[][];
  deadWalls: HTMLCanvasElement[];
  territory: HTMLCanvasElement[];
  rubble: HTMLCanvasElement;
  crater: HTMLCanvasElement[];
  bonus: HTMLCanvasElement;
  castles: HTMLCanvasElement[];
}

function wallSprite(p: { wallLight: RGB; wallMid: RGB; wallDark: RGB; wallEdge: RGB }, mask: number): HTMLCanvasElement {
  const [c, ctx] = canvas(TS, TS);
  const n = mask & 1;
  const e = mask & 2;
  const so = mask & 4;
  const w = mask & 8;
  const px = (x: number, y: number, col: RGB) => {
    ctx.fillStyle = css(col);
    ctx.fillRect(x, y, 1, 1);
  };
  // Body with a subtle brick pattern.
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const row = Math.floor(y / 4);
      const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
      px(x, y, mortar ? mix(p.wallMid, p.wallDark, 0.55) : mix(p.wallMid, p.wallLight, hash(x, y, 7) * 0.25));
    }
  }
  // Raised top face highlight.
  ctx.fillStyle = css(p.wallLight);
  if (!n) ctx.fillRect(0, 0, TS, 3);
  if (!w) ctx.fillRect(0, 0, 2, TS);
  // Shadowed sides.
  ctx.fillStyle = css(p.wallDark);
  if (!so) ctx.fillRect(0, TS - 4, TS, 4);
  if (!e) ctx.fillRect(TS - 3, 0, 3, TS);
  // Crisp outline where the wall ends.
  ctx.fillStyle = css(p.wallEdge);
  if (!n) ctx.fillRect(0, 0, TS, 1);
  if (!so) ctx.fillRect(0, TS - 1, TS, 1);
  if (!w) ctx.fillRect(0, 0, 1, TS);
  if (!e) ctx.fillRect(TS - 1, 0, 1, TS);
  // Crenellations along exposed top edges.
  if (!n) {
    ctx.fillStyle = css(p.wallEdge);
    for (let x = 2; x < TS - 1; x += 5) ctx.fillRect(x, 1, 2, 2);
  }
  return c;
}

function territorySprite(a: RGB, b: RGB): HTMLCanvasElement {
  const [c, ctx] = canvas(TS, TS);
  for (let y = 0; y < TS; y += 4) {
    for (let x = 0; x < TS; x += 4) {
      ctx.fillStyle = css((x + y) % 8 === 0 ? a : b);
      ctx.fillRect(x, y, 4, 4);
    }
  }
  ctx.fillStyle = css(mix(a, [255, 255, 255], 0.12));
  for (let y = 0; y < TS; y += 4) for (let x = 0; x < TS; x += 4) if ((x + y) % 8 === 0) ctx.fillRect(x, y, 1, 1);
  return c;
}

function rubbleSprite(): HTMLCanvasElement {
  const [c, ctx] = canvas(TS, TS);
  const stones: [number, number, number][] = [
    [3, 4, 3],
    [9, 3, 2],
    [11, 9, 3],
    [4, 10, 2],
    [7, 7, 2],
    [13, 13, 2],
    [2, 13, 2],
  ];
  for (const [x, y, r] of stones) {
    ctx.fillStyle = '#3d3d3d';
    ctx.fillRect(x, y + 1, r + 1, r);
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(x, y, r, r);
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(x, y, 1, 1);
  }
  return c;
}

function craterSprite(strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(TS, TS);
  const r = strength > 1 ? 6.5 : 5;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const dx = x + 0.5 - 8;
      const dy = (y + 0.5 - 8) * 1.15;
      const d = Math.hypot(dx, dy) + (hash(x, y, 3) - 0.5) * 1.2;
      if (d > r) continue;
      let col: RGB;
      if (d > r - 1.5) col = hex('#8a5a2a');
      else if (d > r - 3) col = hex('#4a2c12');
      else col = hex('#26160a');
      ctx.fillStyle = css(col, strength > 1 ? 1 : 0.75);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function bonusSprite(): HTMLCanvasElement {
  const [c, ctx] = canvas(TS, TS);
  const pts = [
    [8, 2],
    [14, 8],
    [8, 14],
    [2, 8],
  ];
  ctx.fillStyle = '#6b4a00';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 1) : ctx.moveTo(x, y + 1)));
  ctx.fill();
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.fill();
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(6, 5, 2, 2);
  ctx.fillRect(8, 7, 1, 1);
  ctx.fillStyle = '#c98f00';
  ctx.fillRect(9, 9, 3, 2);
  return c;
}

/** 2x2-tile castle keep with towers; flag in the owner's colour (neutral = white). */
function castleSprite(flag: string, owned: boolean): HTMLCanvasElement {
  const S = TS * 2;
  const [c, ctx] = canvas(S, S);
  const stone = owned ? ['#c9c9cf', '#a2a2ab', '#74747e', '#4a4a52'] : ['#b3b3b3', '#8e8e8e', '#666666', '#404040'];
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // Shadow
  rect(4, 29, 26, 3, 'rgba(0,0,0,0.35)');
  // Towers
  for (const tx of [3, 21]) {
    rect(tx, 9, 8, 21, stone[1]);
    rect(tx, 9, 2, 21, stone[0]);
    rect(tx + 6, 9, 2, 21, stone[2]);
    for (let k = 0; k < 4; k++) rect(tx + k * 2, 6, 1, 3, k % 2 ? stone[3] : stone[0]);
    rect(tx, 8, 8, 1, stone[3]);
    rect(tx + 3, 14, 2, 3, stone[3]);
  }
  // Keep
  rect(9, 12, 14, 18, stone[1]);
  rect(9, 12, 14, 2, stone[0]);
  for (let k = 0; k < 7; k++) rect(9 + k * 2, 10, 1, 2, stone[0]);
  rect(21, 12, 2, 18, stone[2]);
  // Masonry lines
  for (let y = 16; y < 30; y += 4) rect(9, y, 14, 1, stone[2]);
  // Gate
  rect(13, 22, 6, 8, stone[3]);
  rect(14, 21, 4, 1, stone[3]);
  rect(14, 23, 4, 7, '#1f1a16');
  // Windows
  rect(11, 16, 2, 3, '#1f1a16');
  rect(19, 16, 2, 3, '#1f1a16');
  // Flag
  rect(15, 0, 1, 11, '#3b2a1a');
  rect(16, 1, 7, 5, flag);
  rect(16, 5, 7, 1, 'rgba(0,0,0,0.3)');
  rect(22, 2, 1, 3, 'rgba(255,255,255,0.35)');
  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(3.5, 9.5, 7, 20);
  ctx.strokeRect(21.5, 9.5, 7, 20);
  return c;
}

export function buildSprites(): SpriteSet {
  const walls = PALETTES.map((p) => Array.from({ length: 16 }, (_, m) => wallSprite(p, m)));
  const grey = { wallLight: hex('#c8c8c8'), wallMid: hex('#9a9a9a'), wallDark: hex('#6a6a6a'), wallEdge: hex('#333333') };
  const deadWalls = Array.from({ length: 16 }, (_, m) => wallSprite(grey, m));
  return {
    walls,
    deadWalls,
    territory: PALETTES.map((p) => territorySprite(p.terrA, p.terrB)),
    rubble: rubbleSprite(),
    crater: [craterSprite(1), craterSprite(2)],
    bonus: bonusSprite(),
    castles: [castleSprite('#f4f4f4', false), ...PALETTES.map((p) => castleSprite(p.flag, true))],
  };
}

/** Walls, territory, craters, rubble and bonus squares, redrawn when the grid changes. */
export function renderStructures(s: GameState, sp: SpriteSet, target: HTMLCanvasElement | null): HTMLCanvasElement {
  let c = target;
  if (!c || c.width !== s.W * TS || c.height !== s.H * TS) {
    c = document.createElement('canvas');
    c.width = s.W * TS;
    c.height = s.H * TS;
  }
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  const W = s.W;
  for (let y = 0; y < s.H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const px = x * TS;
      const py = y * TS;
      const t = s.territory[i];
      if (t >= 0 && s.wall[i] < 0) ctx.drawImage(sp.territory[t % 4], px, py);
      if (s.bonus[i] && s.wall[i] < 0) ctx.drawImage(sp.bonus, px, py);
      if (s.rubble[i] && s.wall[i] < 0) ctx.drawImage(sp.rubble, px, py);
      if (s.crater[i] && s.wall[i] < 0) ctx.drawImage(sp.crater[Math.min(2, s.crater[i]) - 1], px, py);
      const w = s.wall[i];
      if (w >= 0) {
        const same = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W && yy < s.H && s.wall[yy * W + xx] === w;
        const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
        const alive = s.players[w]?.alive !== false;
        ctx.drawImage(alive ? sp.walls[w % 4][mask] : sp.deadWalls[mask], px, py);
      }
    }
  }
  return c;
}

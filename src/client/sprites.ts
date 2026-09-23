import { GameState, LAND } from '../shared/types';
import { RGB, canvas, css, desaturate, factionCastle, factionWall, hash, hex, mix } from './factions';

/** Source resolution of all pixel art: one tile = TS x TS pixels. */
export const TS = 16;

export interface PlayerPalette {
  main: string;
  wallLight: RGB;
  wallMid: RGB;
  wallDark: RGB;
  wallEdge: RGB;
  terrA: RGB;
  terrB: RGB;
  flag: string;
  flagRGB: RGB;
}

const palette = (main: string, light: string, mid: string, dark: string, edge: string, terrA: string, terrB: string, flag: string): PlayerPalette => ({
  main,
  wallLight: hex(light),
  wallMid: hex(mid),
  wallDark: hex(dark),
  wallEdge: hex(edge),
  terrA: hex(terrA),
  terrB: hex(terrB),
  flag,
  flagRGB: hex(flag),
});

export const PALETTES: PlayerPalette[] = [
  palette('#3f6df2', '#d9e0ff', '#9eaef0', '#5a68c4', '#262d6b', '#1a2766', '#0d1540', '#4f7dff'),
  palette('#e0404f', '#ffe0e3', '#f0a3ab', '#c45a66', '#6b1f28', '#6a1620', '#380a10', '#ff4d5e'),
  palette('#f2b705', '#fff6d0', '#f0d47a', '#c49a2e', '#664a0a', '#6a5010', '#3a2a06', '#ffc823'),
  palette('#a24de8', '#f1e0ff', '#c9a3f0', '#8a5ac4', '#3d1f6b', '#44186a', '#240a3a', '#b565ff'),
];

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

/** All map sprites. Faction walls and castles are drawn on first use and cached. */
export class SpriteSet {
  readonly territory = PALETTES.map((p) => territorySprite(p.terrA, p.terrB));
  readonly rubble = rubbleSprite();
  readonly crater = [craterSprite(1), craterSprite(2)];
  readonly bonus = bonusSprite();
  private wallCache = new Map<string, HTMLCanvasElement[]>();
  private castleCache = new Map<string, HTMLCanvasElement>();

  /** walls(faction, color)[mask], mask bits = neighbours N(1) E(2) S(4) W(8). Fallen players' walls are grey. */
  walls(faction: number, color: number, dead = false): HTMLCanvasElement[] {
    const key = `${faction}:${color}:${dead ? 1 : 0}`;
    let set = this.wallCache.get(key);
    if (!set) {
      const pal = PALETTES[((color % 4) + 4) % 4];
      set = Array.from({ length: 16 }, (_, m) => {
        const c = factionWall(faction, pal, m);
        return dead ? desaturate(c, 0.9, 0.15) : c;
      });
      this.wallCache.set(key, set);
    }
    return set;
  }

  /** A faction's stronghold flying the owner's colours (owner -1: unclaimed, white flag). */
  castle(faction: number, owner: number): HTMLCanvasElement {
    const key = `${faction}:${owner}`;
    let c = this.castleCache.get(key);
    if (!c) {
      c = owner >= 0 ? factionCastle(faction, PALETTES[owner % 4].flag) : desaturate(factionCastle(faction, '#f4f4f4'), 0.45);
      this.castleCache.set(key, c);
    }
    return c;
  }
}

/** A small walled fort showing off a faction's architecture (menus). */
export function drawFactionPreview(c: HTMLCanvasElement, sp: SpriteSet, faction: number, color: number) {
  const cols = 6;
  const rows = 5;
  if (c.width !== cols * TS) {
    c.width = cols * TS;
    c.height = rows * TS;
  }
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  const walls = sp.walls(faction, color);
  const isWall = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && (x === 0 || y === 0 || x === cols - 1 || y === rows - 1);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isWall(x, y)) {
        const mask = (isWall(x, y - 1) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) | (isWall(x, y + 1) ? 4 : 0) | (isWall(x - 1, y) ? 8 : 0);
        ctx.drawImage(walls[mask], x * TS, y * TS);
      } else ctx.drawImage(sp.territory[color % 4], x * TS, y * TS);
    }
  }
  ctx.drawImage(sp.castle(faction, color), 2 * TS, 1 * TS);
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
        const owner = s.players[w];
        ctx.drawImage(sp.walls(owner?.faction ?? 0, w, owner?.alive === false)[mask], px, py);
      }
    }
  }
  return c;
}

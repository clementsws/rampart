/**
 * Pixel art for the six factions' walls and strongholds. Every faction has its own
 * building material and silhouette; the owner's colour shows on bands, banners and domes.
 * Walls are 16x16 tiles picked by neighbour mask (N=1, E=2, S=4, W=8); castles are 32x32.
 */
import type { PlayerPalette } from './sprites';

export type RGB = [number, number, number];

const TS = 16;

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Deterministic hash noise in [0,1). */
export function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Tiny pixel painter. */
class Px {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  r(x: number, y: number, w: number, h: number, c: RGB | string) {
    this.ctx.fillStyle = typeof c === 'string' ? c : css(c);
    this.ctx.fillRect(x, y, w, h);
  }

  p(x: number, y: number, c: RGB | string) {
    this.r(x, y, 1, 1, c);
  }

  clear(x: number, y: number, w = 1, h = 1) {
    this.ctx.clearRect(x, y, w, h);
  }

  /** Horizontal span from x0 to x1 inclusive. */
  span(x0: number, x1: number, y: number, c: RGB | string) {
    if (x1 >= x0) this.r(x0, y, x1 - x0 + 1, 1, c);
  }
}

/** Greys a sprite out (unclaimed castles, walls of fallen players). */
export function desaturate(src: HTMLCanvasElement, amount: number, darken = 0): HTMLCanvasElement {
  const [c, ctx] = canvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    for (let k = 0; k < 3; k++) d[i + k] = (d[i + k] + (l - d[i + k]) * amount) * (1 - darken);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface Edges {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

const edgesOf = (mask: number): Edges => ({ n: !!(mask & 1), e: !!(mask & 2), s: !!(mask & 4), w: !!(mask & 8) });

/** Light on exposed west sides, shadow on exposed south/east sides, crisp outline where the wall ends. */
function shade(d: Px, m: Edges, light: RGB, dark: RGB, edge: RGB, bottom = 3) {
  if (!m.w) d.r(0, 0, 2, TS, light);
  if (!m.s) d.r(0, TS - bottom, TS, bottom, dark);
  if (!m.e) d.r(TS - 2, 0, 2, TS, dark);
  if (!m.s) d.r(0, TS - 1, TS, 1, edge);
  if (!m.w) d.r(0, 0, 1, TS, edge);
  if (!m.e) d.r(TS - 1, 0, 1, TS, edge);
}

// ---------------------------------------------------------------- walls

/** Kingdom: grey-blue ashlar with square crenellations (the classic look). */
function stoneWall(p: PlayerPalette, mask: number, d: Px) {
  const m = edgesOf(mask);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const row = Math.floor(y / 4);
      const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
      d.p(x, y, mortar ? mix(p.wallMid, p.wallDark, 0.55) : mix(p.wallMid, p.wallLight, hash(x, y, 7) * 0.25));
    }
  }
  if (!m.n) d.r(0, 0, TS, 3, p.wallLight);
  if (!m.w) d.r(0, 0, 2, TS, p.wallLight);
  if (!m.s) d.r(0, TS - 4, TS, 4, p.wallDark);
  if (!m.e) d.r(TS - 3, 0, 3, TS, p.wallDark);
  if (!m.n) d.r(0, 0, TS, 1, p.wallEdge);
  if (!m.s) d.r(0, TS - 1, TS, 1, p.wallEdge);
  if (!m.w) d.r(0, 0, 1, TS, p.wallEdge);
  if (!m.e) d.r(TS - 1, 0, 1, TS, p.wallEdge);
  if (!m.n) for (let x = 2; x < TS - 1; x += 5) d.r(x, 1, 2, 2, p.wallEdge);
}

/** Norse: a palisade of sharpened logs lashed with a rope band in the owner's colour. */
function palisadeWall(p: PlayerPalette, mask: number, d: Px) {
  const m = edgesOf(mask);
  const t = (c: string) => mix(hex(c), p.wallMid, 0.12);
  const light = t('#c99058');
  const mid = t('#9a6534');
  const dark = t('#6e421d');
  const gap = hex('#3a2410');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const k = x % 4;
      let col = k === 0 ? light : k === 3 ? gap : mix(mid, dark, k === 2 ? 0.45 : 0);
      if ((k === 1 || k === 2) && hash(x, y, 11) > 0.84) col = dark;
      if ((k === 1 || k === 2) && hash(x >> 2, y, 12) > 0.93) col = hex('#4e2f14');
      d.p(x, y, col);
    }
  }
  // Rope lashing.
  for (let x = 0; x < TS; x++) {
    d.p(x, 8, (x + 1) % 4 < 2 ? p.wallLight : p.wallMid);
    d.p(x, 9, (x + 3) % 4 < 2 ? p.wallMid : p.wallDark);
  }
  if (!m.s) {
    d.r(0, TS - 3, TS, 2, mix(dark, gap, 0.5));
    d.r(0, TS - 1, TS, 1, gap);
  }
  if (!m.e) d.r(TS - 1, 0, 1, TS, gap);
  if (!m.w) d.r(0, 0, 1, TS, mix(light, gap, 0.6));
  if (!m.n) {
    // Sharpened tips with fresh-cut faces.
    for (let lx = 0; lx < TS; lx += 4) {
      d.clear(lx, 0, 4, 1);
      d.clear(lx + 3, 1, 1, 2);
      d.clear(lx, 1, 1, 1);
      d.p(lx + 1, 0, hex('#e3bd86'));
      d.p(lx + 2, 0, hex('#b98a52'));
      d.p(lx + 1, 1, hex('#d9ae74'));
      d.p(lx + 2, 1, mid);
    }
  }
}

/** Sultanate: smooth sandstone with rounded merlons and a band of glazed tiles. */
function sandstoneWall(p: PlayerPalette, mask: number, d: Px) {
  const m = edgesOf(mask);
  const light = hex('#f7e3b8');
  const mid = hex('#e2c18a');
  const dark = hex('#bf955c');
  const edge = hex('#6e5030');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let col = mix(mid, light, hash(x, y, 21) * 0.35);
      if (y % 6 === 5) col = mix(mid, dark, 0.35);
      d.p(x, y, col);
    }
  }
  // Glazed tile band (zellige) in the owner's colour.
  d.r(0, 9, TS, 1, p.wallEdge);
  d.r(0, 12, TS, 1, p.wallEdge);
  for (let y = 10; y < 12; y++)
    for (let x = 0; x < TS; x++) d.p(x, y, (x + y) % 4 < 2 ? p.flagRGB : mix(p.wallLight, [255, 255, 255], 0.5));
  shade(d, m, light, dark, edge);
  if (!m.n) {
    // Rounded (Moorish) merlons: 4 wide with 1-pixel gaps.
    for (let x = 0; x < TS; x++) {
      const k = x % 5;
      if (k === 0) {
        d.clear(x, 0, 1, 3);
        d.p(x, 3, dark);
      } else {
        if (k === 1 || k === 4) d.clear(x, 0, 1, 1);
        d.p(x, k === 1 || k === 4 ? 1 : 0, light);
        if (k === 4) d.p(x, 2, mix(mid, dark, 0.5));
      }
    }
  }
}

/** Shogunate: white plaster under a dark tiled roof, on a base of fitted stones. */
function plasterWall(p: PlayerPalette, mask: number, d: Px) {
  const m = edgesOf(mask);
  const slate = hex('#474e60');
  const slateHi = hex('#6c768c');
  const slateDark = hex('#262a35');
  const plaster = hex('#f3efe6');
  const plasterShade = hex('#d8d1c2');
  // Roof tiles.
  for (let y = 0; y < 6; y++) for (let x = 0; x < TS; x++) d.p(x, y, x % 3 === 0 ? slateHi : y % 2 ? slate : mix(slate, slateHi, 0.3));
  if (!m.n) d.r(0, 0, TS, 1, hex('#8a94aa'));
  d.r(0, 5, TS, 1, slateDark);
  // Painted fascia and plaster.
  d.r(0, 6, TS, 1, p.flagRGB);
  for (let y = 7; y < 12; y++) for (let x = 0; x < TS; x++) d.p(x, y, y === 7 ? plasterShade : plaster);
  // Family crest (mon).
  d.r(7, 8, 2, 3, p.wallDark);
  d.r(6, 9, 4, 1, p.wallDark);
  d.p(7, 9, p.flagRGB);
  d.p(8, 9, p.flagRGB);
  // Stone base.
  for (let y = 12; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const bx = Math.floor((x + (y > 13 ? 3 : 0)) / 5);
      const seam = (x + (y > 13 ? 3 : 0)) % 5 === 4 || y === 13;
      d.p(x, y, seam ? hex('#5a5852') : mix(hex('#9a978d'), hex('#7a776f'), hash(bx, y > 13 ? 1 : 0, 31)));
    }
  }
  if (!m.w) d.r(0, 0, 1, TS, slateDark);
  if (!m.e) d.r(TS - 1, 0, 1, TS, slateDark);
  if (!m.s) d.r(0, TS - 1, TS, 1, hex('#3a3934'));
  if (!m.n) {
    // Upturned eaves at exposed roof ends.
    if (!m.w) d.clear(0, 0, 1, 1);
    if (!m.e) d.clear(TS - 1, 0, 1, 1);
  }
}

/** Aztec: carved stone with a stepped fret band and stepped merlons. */
function templeWall(p: PlayerPalette, mask: number, d: Px) {
  const m = edgesOf(mask);
  const light = hex('#b3ae8e');
  const mid = hex('#908b6b');
  const dark = hex('#6a664b');
  const edge = hex('#393725');
  const jade = hex('#2fae9c');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const row = Math.floor(y / 4);
      const seam = y % 4 === 3 || (x + (row % 2) * 5) % 10 === 9;
      d.p(x, y, seam ? dark : mix(mid, light, hash(x, y, 41) * 0.3));
    }
  }
  // Step-fret band: owner colour steps climbing over jade.
  d.r(0, 7, TS, 1, edge);
  d.r(0, 11, TS, 1, edge);
  for (let y = 8; y < 11; y++) {
    for (let x = 0; x < TS; x++) {
      const k = (x + (y - 8) * 2) % 8;
      d.p(x, y, k < 4 ? p.flagRGB : jade);
    }
  }
  shade(d, m, light, dark, edge);
  if (!m.n) {
    // Stepped merlons.
    for (let x = 0; x < TS; x++) {
      const k = x % 8;
      if (k === 0 || k === 7) d.clear(x, 0, 1, 3);
      else if (k === 1 || k === 6) d.clear(x, 0, 1, 2);
      else if (k === 2 || k === 5) d.clear(x, 0, 1, 1);
      if (k >= 2 && k <= 5) d.p(x, 0, light);
      if (k === 1 || k === 6) d.p(x, 1, light);
      if (k === 0 || k === 7) d.p(x, 3, dark);
    }
  }
}

/** Celtic: an earthen rampart topped with turf and painted stakes, bound with wattle. */
function earthWall(p: PlayerPalette, mask: number, d: Px) {
  const m = edgesOf(mask);
  const turf = [hex('#2c5f26'), hex('#3a7a30'), hex('#55a043')];
  const earth = [hex('#a8784a'), hex('#8a5c32'), hex('#673f1f')];
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const n = hash(x, y, 51);
      if (y < 5) d.p(x, y, turf[n > 0.75 ? 2 : n > 0.3 ? 1 : 0]);
      else d.p(x, y, n > 0.9 ? hex('#9c9a90') : earth[n > 0.6 ? 0 : n > 0.2 ? 1 : 2]);
    }
  }
  d.r(0, 5, TS, 1, hex('#4d3317'));
  // Wattle band woven in the owner's colour.
  for (let x = 0; x < TS; x++) {
    d.p(x, 9, (x >> 1) % 2 ? p.wallMid : p.wallDark);
    d.p(x, 10, (x >> 1) % 2 ? p.wallDark : p.wallLight);
  }
  shade(d, m, earth[0], earth[2], hex('#3a2410'));
  if (!m.n) {
    // Stakes along the crest with painted tips.
    for (let x = 1; x < TS; x += 4) {
      d.r(x, 1, 1, 4, hex('#7a5230'));
      d.p(x + 1, 2, hex('#4d3317'));
      d.p(x, 0, p.flagRGB);
    }
  }
}

const WALL_STYLES = [stoneWall, palisadeWall, sandstoneWall, plasterWall, templeWall, earthWall];

export function factionWall(faction: number, p: PlayerPalette, mask: number): HTMLCanvasElement {
  const [c, ctx] = canvas(TS, TS);
  (WALL_STYLES[faction] ?? stoneWall)(p, mask, new Px(ctx));
  return c;
}

// -------------------------------------------------------------- castles

const S = TS * 2;

function shadow(d: Px) {
  d.r(4, 29, 26, 3, 'rgba(0,0,0,0.35)');
}

/** Kingdom: square keep between two towers, flag on top. */
function keepCastle(d: Px, flag: string) {
  const stone = ['#c9c9cf', '#a2a2ab', '#74747e', '#4a4a52'];
  shadow(d);
  for (const tx of [3, 21]) {
    d.r(tx, 9, 8, 21, stone[1]);
    d.r(tx, 9, 2, 21, stone[0]);
    d.r(tx + 6, 9, 2, 21, stone[2]);
    for (let k = 0; k < 4; k++) d.r(tx + k * 2, 6, 1, 3, k % 2 ? stone[3] : stone[0]);
    d.r(tx, 8, 8, 1, stone[3]);
    d.r(tx + 3, 14, 2, 3, stone[3]);
  }
  d.r(9, 12, 14, 18, stone[1]);
  d.r(9, 12, 14, 2, stone[0]);
  for (let k = 0; k < 7; k++) d.r(9 + k * 2, 10, 1, 2, stone[0]);
  d.r(21, 12, 2, 18, stone[2]);
  for (let y = 16; y < 30; y += 4) d.r(9, y, 14, 1, stone[2]);
  d.r(13, 22, 6, 8, stone[3]);
  d.r(14, 21, 4, 1, stone[3]);
  d.r(14, 23, 4, 7, '#1f1a16');
  d.r(11, 16, 2, 3, '#1f1a16');
  d.r(19, 16, 2, 3, '#1f1a16');
  d.r(15, 0, 1, 11, '#3b2a1a');
  d.r(16, 1, 7, 5, flag);
  d.r(16, 5, 7, 1, 'rgba(0,0,0,0.3)');
  d.r(22, 2, 1, 3, 'rgba(255,255,255,0.35)');
  d.ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  d.ctx.lineWidth = 1;
  d.ctx.strokeRect(3.5, 9.5, 7, 20);
  d.ctx.strokeRect(21.5, 9.5, 7, 20);
}

/** Norse: timber longhall with a steep shingled roof, dragon-head gables and painted shields. */
function longhallCastle(d: Px, flag: string) {
  shadow(d);
  // Plank walls.
  for (let x = 3; x <= 28; x++) {
    d.r(x, 17, 1, 13, x % 3 === 0 ? '#6a4020' : x % 3 === 1 ? '#9a6534' : '#85552b');
  }
  d.r(3, 17, 26, 1, '#b07a45');
  d.r(3, 29, 26, 1, '#3a2410');
  // Door with a carved lintel.
  d.r(13, 21, 6, 9, '#5e3b1c');
  d.r(14, 22, 4, 8, '#24160a');
  // Shields in the owner's colour.
  for (const cx of [7, 24]) {
    d.r(cx - 2, 21, 5, 3, flag);
    d.r(cx - 1, 20, 3, 5, flag);
    d.p(cx, 22, '#e0e0e0');
    d.p(cx - 1, 20, 'rgba(0,0,0,0.25)');
    d.p(cx + 1, 24, 'rgba(0,0,0,0.3)');
  }
  // Steep roof.
  for (let y = 6; y <= 17; y++) {
    const half = Math.round(5 + (y - 6) * 0.95);
    const x0 = 16 - half;
    const x1 = 15 + half;
    for (let x = x0; x <= x1; x++) {
      const shingle = (x + (y % 2) * 2) % 4 === 0;
      d.p(x, y, x === x0 || x === x1 ? '#2e1d0e' : shingle ? '#4a2e14' : y % 2 ? '#7a4a22' : '#6a3f1c');
    }
  }
  d.span(11, 20, 5, '#2e1d0e');
  d.span(0, 31, 17, '#2e1d0e');
  // Dragon heads on the gable ends.
  for (const [x, y] of [
    [10, 5],
    [9, 4],
    [8, 3],
    [8, 2],
    [9, 1],
    [10, 1],
  ]) {
    d.p(x, y, '#3a2410');
    d.p(31 - x, y, '#3a2410');
  }
  d.p(10, 2, '#ffcc33');
  d.p(21, 2, '#ffcc33');
  // Raven banner.
  d.r(16, 0, 1, 6, '#2a1a0c');
  d.span(17, 22, 0, flag);
  d.span(17, 21, 1, flag);
  d.span(17, 20, 2, flag);
  d.span(17, 18, 3, flag);
  d.p(18, 1, 'rgba(0,0,0,0.45)');
}

/** Sultanate: sandstone palace with an onion dome (in the owner's colour) and a minaret. */
function palaceCastle(d: Px, flag: string) {
  const sand = ['#f7e3b8', '#e2c18a', '#bf955c', '#7a5a32'];
  shadow(d);
  // Palace block with rounded merlons.
  d.r(2, 16, 22, 14, sand[1]);
  d.r(2, 16, 2, 14, sand[0]);
  d.r(22, 16, 2, 14, sand[2]);
  for (let x = 2; x < 24; x += 3) d.r(x, 14, 2, 2, sand[0]);
  d.r(2, 16, 22, 1, sand[2]);
  d.r(2, 25, 22, 1, sand[2]);
  // Horseshoe-arch gate and windows.
  d.r(10, 22, 6, 8, sand[3]);
  d.r(11, 21, 4, 1, sand[3]);
  d.r(11, 22, 4, 8, '#2a1a0c');
  d.r(12, 21, 2, 1, '#2a1a0c');
  for (const wx of [5, 19]) {
    d.r(wx, 19, 2, 3, '#2a1a0c');
    d.p(wx, 18, sand[3]);
    d.p(wx + 1, 18, sand[3]);
  }
  // Drum and onion dome.
  d.r(6, 12, 14, 4, sand[0]);
  d.r(6, 15, 14, 1, sand[2]);
  const widths = [1, 2, 3, 4, 5, 6, 6, 6, 5];
  const f = hex(flag);
  widths.forEach((w, k) => {
    const y = 3 + k;
    for (let x = 13 - w; x <= 12 + w; x++) {
      const t = (x - (13 - w)) / (2 * w);
      d.p(x, y, css(t < 0.3 ? mix(f, [255, 255, 255], 0.35) : t > 0.75 ? mix(f, [0, 0, 0], 0.3) : f));
    }
  });
  d.span(8, 17, 12, css(mix(f, [0, 0, 0], 0.35)));
  // Golden finial and crescent.
  d.r(12, 0, 1, 3, '#ffd23a');
  d.p(13, 0, '#ffd23a');
  d.p(11, 1, '#c98f00');
  // Minaret.
  d.r(25, 7, 4, 23, sand[1]);
  d.r(25, 7, 1, 23, sand[0]);
  d.r(28, 7, 1, 23, sand[2]);
  d.r(24, 12, 6, 2, sand[3]);
  d.r(26, 16, 2, 2, '#2a1a0c');
  d.r(26, 3, 2, 4, flag);
  d.r(25, 5, 4, 2, flag);
  d.p(26, 3, css(mix(f, [255, 255, 255], 0.35)));
  d.r(26, 1, 1, 2, '#ffd23a');
}

/** Shogunate: three-tier pagoda keep on a sloped stone base, with a nobori banner. */
function pagodaCastle(d: Px, flag: string) {
  const white = '#f3efe6';
  const shade = '#d3ccbc';
  const roof = '#3e4454';
  const roofHi = '#6c768c';
  const eave = '#20232c';
  shadow(d);
  // Sloped stone base.
  for (let y = 23; y <= 29; y++) {
    const inset = Math.floor((29 - y) * 0.5);
    for (let x = 4 + inset; x <= 27 - inset; x++) d.p(x, y, (x + (y % 2) * 2) % 4 === 0 || y % 3 === 0 ? '#6e6c66' : '#908d85');
  }
  const tier = (y0: number, y1: number, x0: number, x1: number) => {
    d.r(x0, y0, x1 - x0 + 1, y1 - y0 + 1, white);
    d.r(x1 - 1, y0, 2, y1 - y0 + 1, shade);
  };
  const roofBand = (y: number, x0: number, x1: number, rows: number) => {
    for (let k = 0; k < rows; k++) {
      const ex = rows - 1 - k;
      for (let x = x0 - k; x <= x1 + k; x++) d.p(x, y + k, (x + k) % 3 === 0 ? roofHi : roof);
      if (ex === 0) {
        d.span(x0 - k, x1 + k, y + k, eave);
        d.p(x0 - k - 1, y + k - 1, eave);
        d.p(x1 + k + 1, y + k - 1, eave);
      }
    }
  };
  tier(19, 23, 7, 24);
  for (const wx of [10, 14, 17, 21]) d.r(wx, 20, 1, 2, '#1b1b1f');
  roofBand(15, 8, 23, 4);
  tier(12, 15, 9, 22);
  for (const wx of [12, 16, 19]) d.r(wx, 13, 1, 1, '#1b1b1f');
  roofBand(9, 10, 21, 3);
  tier(6, 9, 11, 20);
  roofBand(3, 12, 19, 3);
  // Gable in the owner's colour, golden shachihoko on the ridge.
  d.span(15, 16, 15, flag);
  d.span(14, 17, 16, flag);
  d.r(11, 1, 1, 2, '#ffd23a');
  d.p(10, 1, '#ffd23a');
  d.r(20, 1, 1, 2, '#ffd23a');
  d.p(21, 1, '#ffd23a');
  d.span(12, 19, 2, roof);
  // Nobori banner.
  d.r(1, 4, 1, 26, '#2a1a0c');
  d.r(2, 5, 3, 11, flag);
  d.r(2, 4, 4, 1, '#2a1a0c');
  d.r(3, 7, 1, 2, 'rgba(255,255,255,0.6)');
}

/** Aztec: stepped pyramid with a central stair, braziers and a temple crested in the owner's colour. */
function pyramidCastle(d: Px, flag: string) {
  const light = '#bdb795';
  const mid = '#9a9574';
  const dark = '#6a664b';
  const edge = '#3d3a28';
  shadow(d);
  const step = (y0: number, y1: number, x0: number, x1: number) => {
    d.r(x0, y0, x1 - x0 + 1, y1 - y0 + 1, mid);
    d.span(x0, x1, y0, light);
    d.span(x0, x1, y1, dark);
    d.r(x1, y0, 1, y1 - y0 + 1, dark);
    for (let x = x0 + 3; x < x1; x += 5) d.r(x, y0 + 2, 1, y1 - y0 - 2, dark);
  };
  step(24, 29, 1, 30);
  step(19, 24, 4, 27);
  step(14, 19, 7, 24);
  step(10, 14, 10, 21);
  // Stair.
  for (let y = 10; y <= 29; y++) d.span(13, 18, y, y % 2 ? light : '#d4cfae');
  d.r(12, 10, 1, 20, edge);
  d.r(19, 10, 1, 20, edge);
  // Jade band across the second step.
  d.span(4, 11, 21, '#2fae9c');
  d.span(20, 27, 21, '#2fae9c');
  // Temple.
  d.r(11, 4, 10, 7, '#d4cfae');
  d.r(19, 4, 2, 7, mid);
  d.r(14, 6, 4, 5, '#241c14');
  d.r(10, 2, 12, 2, flag);
  for (const x of [11, 14, 17, 20]) d.p(x, 1, flag);
  d.span(10, 21, 4, edge);
  // Braziers.
  for (const bx of [8, 23]) {
    d.r(bx, 12, 2, 2, edge);
    d.p(bx, 11, '#ff9a1f');
    d.p(bx + 1, 10, '#ffd23a');
    d.p(bx + 1, 11, '#ff5a1f');
  }
}

/** Celtic: thatched roundhouse inside an earthen ring, with a standing stone and a pennant. */
function hillfortCastle(d: Px, flag: string) {
  shadow(d);
  // Earthen ring with a gap for the gate.
  for (let y = 15; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = (x + 0.5 - 16) / 15.5;
      const dy = (y + 0.5 - 23.5) / 7.5;
      const r = Math.hypot(dx, dy);
      if (r > 1 || r < 0.72) continue;
      if (y > 26 && x >= 13 && x <= 18) continue;
      const top = r < 0.86;
      d.p(x, y, top ? (hash(x, y, 61) > 0.5 ? '#3d7e2e' : '#4f9a3c') : y > 23 ? '#6e4827' : '#8b5e34');
    }
  }
  // Standing stone.
  d.r(2, 10, 3, 9, '#8e8c86');
  d.r(2, 10, 1, 9, '#b5b3ab');
  d.r(4, 11, 1, 8, '#66645e');
  // Roundhouse walls.
  d.r(9, 18, 14, 8, '#d9c49a');
  d.r(20, 18, 3, 8, '#b8a27a');
  for (let x = 9; x < 23; x += 2) d.p(x, 21, '#b8a27a');
  d.r(14, 20, 4, 6, '#2a1a0c');
  // Conical thatch.
  for (let y = 4; y <= 19; y++) {
    const half = Math.round((y - 4) * 0.7) + 1;
    for (let x = 16 - half; x < 16 + half; x++) {
      const stripe = (x + y * 2) % 5 === 0;
      d.p(x, y, x === 16 - half || y === 19 ? '#7a5a22' : stripe ? '#a47f35' : x < 16 ? '#e0c070' : '#c9a24e');
    }
  }
  // Smoke hole and pennant.
  d.r(15, 3, 2, 1, '#7a5a22');
  d.r(16, 0, 1, 4, '#3a2410');
  d.span(17, 21, 0, flag);
  d.span(17, 20, 1, flag);
  d.span(17, 18, 2, flag);
}

const CASTLE_STYLES = [keepCastle, longhallCastle, palaceCastle, pagodaCastle, pyramidCastle, hillfortCastle];

export function factionCastle(faction: number, flag: string): HTMLCanvasElement {
  const [c, ctx] = canvas(S, S);
  (CASTLE_STYLES[faction] ?? keepCastle)(new Px(ctx), flag);
  return c;
}

/** Barrel colours for each faction's cannons: [barrel, band]. */
export const CANNON_METAL: [string, string][] = [
  ['#1a1a1a', '#3a3a3a'],
  ['#2b2622', '#6a4020'],
  ['#8a6a2a', '#d9b24a'],
  ['#1b1c22', '#c9a227'],
  ['#2a2433', '#2fae9c'],
  ['#6e5222', '#b98a3a'],
];

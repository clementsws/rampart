import { Rng } from './rng';
import { LAND, Mode, WATER } from './types';

export interface MapData {
  W: number;
  H: number;
  terrain: Uint8Array;
  region: Int8Array;
  bonus: Uint8Array;
  castles: { x: number; y: number; region: number }[];
}

/** 1D value noise in [-1, 1] with cosine interpolation. */
function noise1D(rng: Rng, len: number, scale: number): (t: number) => number {
  const n = Math.ceil(len / scale) + 3;
  const pts = Array.from({ length: n }, () => rng.range(-1, 1));
  return (t: number) => {
    const u = t / scale;
    const i = Math.floor(u);
    const f = u - i;
    const a = pts[Math.max(0, Math.min(n - 1, i))];
    const b = pts[Math.max(0, Math.min(n - 1, i + 1))];
    const w = (1 - Math.cos(f * Math.PI)) / 2;
    return a * (1 - w) + b * w;
  };
}

/** Meandering river centre line: one value per row (or column), moving at most one tile per step. */
function riverPath(rng: Rng, len: number, base: number, amp: number): number[] {
  const nz = noise1D(rng, len, 5 + rng.next() * 3);
  const out: number[] = [];
  let prev = base;
  for (let i = 0; i < len; i++) {
    const target = base + Math.round(nz(i) * amp);
    const cur = i === 0 ? target : prev + Math.max(-1, Math.min(1, target - prev));
    out.push(cur);
    prev = cur;
  }
  return out;
}

interface Layout {
  W: number;
  H: number;
  vRivers: number[];
  hRivers: number[];
  regionOf: (col: number, row: number) => number;
  castlesPerRegion: number;
  bonusPerRegion: number;
}

function layoutFor(mode: Mode, players: number): Layout {
  if (mode === 'solo') {
    return { W: 40, H: 22, vRivers: [], hRivers: [], regionOf: () => 0, castlesPerRegion: 5, bonusPerRegion: 4 };
  }
  if (players <= 2) {
    return { W: 48, H: 22, vRivers: [24], hRivers: [], regionOf: (c) => c, castlesPerRegion: 4, bonusPerRegion: 3 };
  }
  if (players === 3) {
    return { W: 60, H: 22, vRivers: [20, 40], hRivers: [], regionOf: (c) => c, castlesPerRegion: 3, bonusPerRegion: 3 };
  }
  return {
    W: 48,
    H: 30,
    vRivers: [24],
    hRivers: [15],
    regionOf: (c, r) => r * 2 + c,
    castlesPerRegion: 3,
    bonusPerRegion: 2,
  };
}

export function generateMap(mode: Mode, players: number, seed: number): MapData {
  const rng = new Rng(seed);
  const L = layoutFor(mode, players);
  const { W, H } = L;
  const N = W * H;
  const terrain = new Uint8Array(N).fill(LAND);
  const region = new Int8Array(N).fill(-1);
  const bonus = new Uint8Array(N);
  const at = (x: number, y: number) => y * W + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // Irregular sea margin around the map edges.
  const depth = (len: number) => {
    const nz = noise1D(rng, len, 4 + rng.next() * 3);
    return (t: number) => 1 + Math.floor((nz(t) + 1) * 1.1);
  };
  const dTop = depth(W);
  const dBottom = depth(W);
  const dLeft = depth(H);
  const dRight = depth(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y < dTop(x) || y >= H - dBottom(x) || x < dLeft(y) || x >= W - dRight(y)) terrain[at(x, y)] = WATER;
    }
  }

  const carveEllipse = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        if (!inb(x, y)) continue;
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) terrain[at(x, y)] = WATER;
      }
    }
  };

  if (mode === 'solo') {
    // Open sea to the east with a ragged coastline and a couple of bays for the fleet.
    const nz = noise1D(rng, H, 5);
    const coast: number[] = [];
    for (let y = 0; y < H; y++) coast.push(Math.round(W * 0.6 + nz(y) * 3));
    for (let y = 0; y < H; y++) for (let x = coast[y]; x < W; x++) terrain[at(x, y)] = WATER;
    for (let b = 0; b < 2; b++) {
      const by = 4 + rng.int(H - 8);
      carveEllipse(coast[by] - 1, by + 0.5, 2 + rng.next() * 1.5, 1.5 + rng.next());
    }
  }

  const vPaths = L.vRivers.map((b) => riverPath(rng, H, b, 3));
  const hPaths = L.hRivers.map((b) => riverPath(rng, W, b, 2));
  for (const rx of vPaths) {
    for (let y = 0; y < H; y++) {
      terrain[at(rx[y] - 1, y)] = WATER;
      terrain[at(rx[y], y)] = WATER;
    }
  }
  for (const ry of hPaths) {
    for (let x = 0; x < W; x++) {
      terrain[at(x, ry[x] - 1)] = WATER;
      terrain[at(x, ry[x])] = WATER;
    }
  }

  // Lakes on the rivers, like the pond in the arcade two-player map.
  if (vPaths.length && hPaths.length) {
    carveEllipse(L.vRivers[0], L.hRivers[0], 3, 2.5);
  } else {
    for (const rx of vPaths) {
      const ly = Math.floor(H / 2) - 3 + rng.int(6);
      carveEllipse(rx[ly], ly + 0.5, 2.2 + rng.next(), 1.8 + rng.next() * 0.8);
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      if (terrain[i] !== LAND) continue;
      let col = 0;
      for (const rx of vPaths) if (x > rx[y]) col++;
      let row = 0;
      for (const ry of hPaths) if (y > ry[x]) row++;
      region[i] = L.regionOf(col, row);
    }
  }

  // Keep only the largest connected landmass of each region; stray islets become water.
  const regions = mode === 'solo' ? 1 : players;
  const seen = new Uint8Array(N);
  const best: number[][] = Array.from({ length: regions }, () => []);
  for (let i = 0; i < N; i++) {
    if (seen[i] || region[i] < 0) continue;
    const r = region[i];
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const cx = c % W;
      const cy = (c - cx) / W;
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const n = at(nx, ny);
        if (!seen[n] && region[n] === r) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (comp.length > best[r].length) {
      for (const c of best[r]) {
        region[c] = -1;
        terrain[c] = WATER;
      }
      best[r] = comp;
    } else {
      for (const c of comp) {
        region[c] = -1;
        terrain[c] = WATER;
      }
    }
  }

  // Castles: 2x2, with clear land around them so a starting wall ring always fits.
  const castles: MapData['castles'] = [];
  const clearance = (x: number, y: number, r: number, c: number) => {
    for (let yy = y - c; yy <= y + 1 + c; yy++) {
      for (let xx = x - c; xx <= x + 1 + c; xx++) {
        if (!inb(xx, yy) || region[at(xx, yy)] !== r) return false;
      }
    }
    return true;
  };
  for (let r = 0; r < regions; r++) {
    const mine: { x: number; y: number }[] = [];
    for (const [c, minDist] of [
      [3, 6],
      [2, 5],
      [1, 4],
    ] as const) {
      if (mine.length >= L.castlesPerRegion) break;
      const cands: { x: number; y: number }[] = [];
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) if (clearance(x, y, r, c)) cands.push({ x, y });
      rng.shuffle(cands);
      for (const p of cands) {
        if (mine.length >= L.castlesPerRegion) break;
        if (mine.every((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) >= minDist)) mine.push(p);
      }
    }
    for (const m of mine) castles.push({ x: m.x, y: m.y, region: r });
  }

  // Bonus squares: open land away from castles and the shore.
  for (let r = 0; r < regions; r++) {
    const cands: number[] = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (region[at(x, y)] !== r) continue;
        if (DIRS8.some(([dx, dy]) => region[at(x + dx, y + dy)] !== r)) continue;
        if (castles.some((c) => x >= c.x - 3 && x <= c.x + 4 && y >= c.y - 3 && y <= c.y + 4)) continue;
        cands.push(at(x, y));
      }
    }
    rng.shuffle(cands);
    let placed = 0;
    for (const i of cands) {
      if (placed >= L.bonusPerRegion) break;
      const x = i % W;
      const y = (i - x) / W;
      let near = false;
      for (let yy = y - 3; yy <= y + 3 && !near; yy++)
        for (let xx = x - 3; xx <= x + 3; xx++) if (inb(xx, yy) && bonus[at(xx, yy)]) near = true;
      if (near) continue;
      bonus[i] = 1;
      placed++;
    }
  }

  return { W, H, terrain, region, bonus, castles };
}

export const DIRS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const DIRS8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

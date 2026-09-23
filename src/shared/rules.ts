import { Cell } from './pieces';
import { GameState, LAND } from './types';

export const OBS_CASTLE = 1;
export const OBS_CANNON = 2;
export const OBS_GRUNT = 3;

/**
 * Marks every tile of the outside that is reachable from the map border without
 * crossing one of `pid`'s walls (4-connectivity). Everything else that is not
 * one of those walls is enclosed territory.
 */
export function computeEnclosed(W: number, H: number, wall: Int8Array, pid: number, out: Uint8Array): number {
  const N = W * H;
  const outside = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!outside[i] && wall[i] !== pid) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < N - W) push(i + W);
  }
  let count = 0;
  for (let i = 0; i < N; i++) {
    const inside = !outside[i] && wall[i] !== pid ? 1 : 0;
    out[i] = inside;
    count += inside;
  }
  return count;
}

/** Tiles occupied by castles, cannons (live ones) and grunts. */
export function obstacleMap(s: GameState): Uint8Array {
  const obs = new Uint8Array(s.W * s.H);
  const mark2 = (x: number, y: number, v: number) => {
    const i = y * s.W + x;
    obs[i] = obs[i + 1] = obs[i + s.W] = obs[i + s.W + 1] = v;
  };
  for (const c of s.castles) mark2(c.x, c.y, OBS_CASTLE);
  for (const c of s.cannons) mark2(c.x, c.y, OBS_CANNON);
  for (const g of s.grunts) obs[g.y * s.W + g.x] = OBS_GRUNT;
  return obs;
}

/** Can `pid` build a wall on tile i right now? */
export function buildable(s: GameState, pid: number, i: number, obs: Uint8Array): boolean {
  return s.region[i] === pid && s.terrain[i] === LAND && s.wall[i] < 0 && s.crater[i] === 0 && obs[i] === 0;
}

export function canPlacePiece(s: GameState, pid: number, cells: readonly Cell[], x: number, y: number, obs: Uint8Array): boolean {
  for (const [dx, dy] of cells) {
    const tx = x + dx;
    const ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= s.W || ty >= s.H) return false;
    if (!buildable(s, pid, ty * s.W + tx, obs)) return false;
  }
  return true;
}

/** Cannons go on free land fully inside the player's territory. */
export function canPlaceCannon(s: GameState, pid: number, x: number, y: number, obs: Uint8Array): boolean {
  if (x < 0 || y < 0 || x >= s.W - 1 || y >= s.H - 1) return false;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = (y + dy) * s.W + x + dx;
      if (s.territory[i] !== pid || s.terrain[i] !== LAND || s.wall[i] >= 0 || s.crater[i] > 0 || obs[i]) return false;
    }
  }
  return true;
}

export function hasCannonSpot(s: GameState, pid: number, obs: Uint8Array): boolean {
  for (let y = 0; y < s.H - 1; y++) {
    for (let x = 0; x < s.W - 1; x++) {
      if (s.territory[y * s.W + x] === pid && canPlaceCannon(s, pid, x, y, obs)) return true;
    }
  }
  return false;
}

/** Bounding box of a player's region, used to clamp cursors. */
export function regionBounds(s: GameState, pid: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = s.W;
  let y0 = s.H;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < s.H; y++) {
    for (let x = 0; x < s.W; x++) {
      if (s.region[y * s.W + x] === pid) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x0 > x1) return { x0: 0, y0: 0, x1: s.W - 1, y1: s.H - 1 };
  return { x0, y0, x1, y1 };
}

export function castleAt(s: GameState, x: number, y: number) {
  return s.castles.find((c) => x >= c.x && x <= c.x + 1 && y >= c.y && y <= c.y + 1);
}

export function cannonAt(s: GameState, x: number, y: number) {
  return s.cannons.find((c) => x >= c.x && x <= c.x + 1 && y >= c.y && y <= c.y + 1);
}

/** Cannons granted in the next arming phase: two for the home castle, one for each other castle. */
export function cannonAllowance(s: GameState, pid: number): number {
  let n = 0;
  for (const c of s.castles) if (c.owner === pid) n += c.id === s.players[pid].home ? 2 : 1;
  return n;
}

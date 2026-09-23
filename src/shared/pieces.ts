/**
 * Wall pieces. Cells are relative to an anchor near the piece centre so that
 * rotating a piece keeps it roughly in place under the player's finger.
 */
export type Cell = readonly [number, number];

interface PieceDef {
  name: string;
  weight: number;
  cells: Cell[];
}

export const PIECE_DEFS: PieceDef[] = [
  { name: 'dot', weight: 3, cells: [[0, 0]] },
  { name: 'duo', weight: 6, cells: [[0, 0], [1, 0]] },
  { name: 'i3', weight: 8, cells: [[-1, 0], [0, 0], [1, 0]] },
  { name: 'corner', weight: 10, cells: [[0, 0], [1, 0], [0, 1]] },
  { name: 'i4', weight: 6, cells: [[-1, 0], [0, 0], [1, 0], [2, 0]] },
  { name: 'l4', weight: 8, cells: [[0, -1], [0, 0], [0, 1], [1, 1]] },
  { name: 'j4', weight: 8, cells: [[0, -1], [0, 0], [0, 1], [-1, 1]] },
  { name: 't4', weight: 7, cells: [[-1, 0], [0, 0], [1, 0], [0, 1]] },
  { name: 's4', weight: 5, cells: [[0, 0], [1, 0], [-1, 1], [0, 1]] },
  { name: 'z4', weight: 5, cells: [[-1, 0], [0, 0], [0, 1], [1, 1]] },
  { name: 'o4', weight: 4, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: 'u5', weight: 6, cells: [[-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] },
  { name: 'v5', weight: 5, cells: [[-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]] },
  { name: 'plus', weight: 2, cells: [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]] },
  { name: 't5', weight: 3, cells: [[-1, -1], [0, -1], [1, -1], [0, 0], [0, 1]] },
  { name: 'z5', weight: 2, cells: [[-1, -1], [0, -1], [0, 0], [0, 1], [1, 1]] },
];

export const PIECE_WEIGHTS = PIECE_DEFS.map((p) => p.weight);

function rotateCells(cells: readonly Cell[]): Cell[] {
  return cells.map(([x, y]) => [-y, x] as const);
}

/** ROTATIONS[shape][rot] -> cells */
export const ROTATIONS: Cell[][][] = PIECE_DEFS.map((def) => {
  const rots: Cell[][] = [def.cells];
  for (let r = 1; r < 4; r++) rots.push(rotateCells(rots[r - 1]));
  return rots;
});

/** Rotations that produce distinct cell sets (used by the AI to avoid duplicate work). */
export const UNIQUE_ROTATIONS: number[][] = ROTATIONS.map((rots) => {
  const seen = new Set<string>();
  const out: number[] = [];
  rots.forEach((cells, r) => {
    const minX = Math.min(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    const key = cells
      .map(([x, y]) => `${x - minX},${y - minY}`)
      .sort()
      .join(';');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  });
  return out;
});

export function pieceCells(shape: number, rot: number): Cell[] {
  return ROTATIONS[shape][((rot % 4) + 4) % 4];
}

/** 2x2 footprint used for cannon placement. */
export const CANNON_CELLS: Cell[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

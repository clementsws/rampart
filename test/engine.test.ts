import { describe, expect, it } from 'vitest';
import { sealingCut } from '../src/shared/ai';
import { TICK } from '../src/shared/constants';
import { Game, GameConfig } from '../src/shared/engine';
import { generateMap } from '../src/shared/mapgen';
import { PIECE_DEFS, ROTATIONS, UNIQUE_ROTATIONS, pieceCells } from '../src/shared/pieces';
import { Encoder, applyTick, encodeStatic, stateFromStatic } from '../src/shared/protocol';
import { canPlacePiece, computeEnclosed, obstacleMap } from '../src/shared/rules';
import { LAND } from '../src/shared/types';

const cpu = (n: number, difficulty: 'easy' | 'normal' | 'hard' = 'normal') =>
  Array.from({ length: n }, (_, i) => ({ name: `CPU${i}`, ai: true, difficulty }));

function runUntil(g: Game, pred: () => boolean, maxTime = 2000) {
  while (!pred() && g.s.time < maxTime) g.tick(TICK);
}

describe('pieces', () => {
  it('has four rotations of equal size for every piece', () => {
    ROTATIONS.forEach((rots, i) => {
      expect(rots).toHaveLength(4);
      for (const r of rots) expect(r).toHaveLength(PIECE_DEFS[i].cells.length);
    });
  });

  it('detects symmetric pieces', () => {
    const byName = (n: string) => PIECE_DEFS.findIndex((p) => p.name === n);
    expect(UNIQUE_ROTATIONS[byName('o4')]).toHaveLength(1);
    expect(UNIQUE_ROTATIONS[byName('plus')]).toHaveLength(1);
    expect(UNIQUE_ROTATIONS[byName('i4')]).toHaveLength(2);
    expect(UNIQUE_ROTATIONS[byName('l4')]).toHaveLength(4);
  });

  it('rotating four times returns the original cells', () => {
    for (let s = 0; s < PIECE_DEFS.length; s++) expect(pieceCells(s, 4)).toEqual(pieceCells(s, 0));
  });
});

describe('enclosure', () => {
  const W = 10;
  const H = 8;
  const ring = (gap = -1) => {
    const wall = new Int8Array(W * H).fill(-1);
    let k = 0;
    for (let y = 2; y <= 6; y++)
      for (let x = 2; x <= 7; x++) {
        if (x === 2 || x === 7 || y === 2 || y === 6) {
          if (k++ !== gap) wall[y * W + x] = 0;
        }
      }
    return wall;
  };

  it('counts tiles inside a closed ring', () => {
    const out = new Uint8Array(W * H);
    expect(computeEnclosed(W, H, ring(), 0, out)).toBe(4 * 3);
  });

  it('leaks through a single missing tile', () => {
    const out = new Uint8Array(W * H);
    expect(computeEnclosed(W, H, ring(3), 0, out)).toBe(0);
  });

  it('treats diagonal corners as sealed and ignores other players walls', () => {
    const wall = ring();
    wall[2 * W + 2] = -1; // remove a corner: still sealed with 4-connectivity
    const out = new Uint8Array(W * H);
    expect(computeEnclosed(W, H, wall, 0, out)).toBe(12);
    expect(computeEnclosed(W, H, wall, 1, out)).toBe(0);
  });
});

describe('sealing cut (AI planner)', () => {
  it('finds exactly the gap in an almost closed ring', () => {
    const W = 9;
    const H = 9;
    const kind = new Uint8Array(W * H).fill(1);
    const cost = new Uint8Array(W * H).fill(1);
    const core = new Uint8Array(W * H);
    for (let y = 2; y <= 6; y++)
      for (let x = 2; x <= 6; x++) {
        if (x === 2 || x === 6 || y === 2 || y === 6) kind[y * W + x] = 0;
        else core[y * W + x] = 1;
      }
    kind[2 * W + 4] = 1; // gap at (4,2)
    expect(sealingCut(W, H, kind, cost, core)).toEqual([2 * W + 4]);
  });

  it('routes around an unbuildable crater in the gap', () => {
    const W = 9;
    const H = 9;
    const kind = new Uint8Array(W * H).fill(1);
    const cost = new Uint8Array(W * H).fill(1);
    const core = new Uint8Array(W * H);
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) core[y * W + x] = 1;
    for (let y = 2; y <= 6; y++)
      for (let x = 2; x <= 6; x++) if (!core[y * W + x] && !(x === 4 && y === 2)) kind[y * W + x] = 0;
    kind[2 * W + 4] = 2; // crater where the gap is
    const cut = sealingCut(W, H, kind, cost, core)!;
    expect(cut).not.toBeNull();
    expect(cut).not.toContain(2 * W + 4);
    const wall = new Int8Array(W * H).fill(-1);
    for (let i = 0; i < W * H; i++) if (kind[i] === 0) wall[i] = 0;
    for (const i of cut) wall[i] = 0;
    const out = new Uint8Array(W * H);
    computeEnclosed(W, H, wall, 0, out);
    for (let i = 0; i < W * H; i++) if (core[i]) expect(out[i]).toBe(1);
  });
});

describe('map generation', () => {
  const cases: [GameConfig['mode'], number][] = [
    ['solo', 1],
    ['versus', 2],
    ['versus', 3],
    ['versus', 4],
  ];
  for (const [mode, n] of cases) {
    it(`gives every ${mode}/${n} region castles with room for a starting wall`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const map = generateMap(mode, n, seed * 7919);
        for (let r = 0; r < n; r++) {
          const castles = map.castles.filter((c) => c.region === r);
          expect(castles.length).toBeGreaterThanOrEqual(2);
          for (const c of castles) {
            for (const [dx, dy] of [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ])
              expect(map.region[(c.y + dy) * map.W + c.x + dx]).toBe(r);
          }
        }
        const g = new Game({ mode, seed: seed * 7919, players: cpu(n) });
        for (let r = 0; r < n; r++) {
          const home = g.defaultCastle(r)!;
          expect(g.homeRing(home.id).complete).toBe(true);
        }
      }
    });
  }

  it('is deterministic for a seed', () => {
    const a = generateMap('versus', 4, 42);
    const b = generateMap('versus', 4, 42);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.castles).toEqual(b.castles);
  });
});

describe('rules and actions', () => {
  it('only allows building on free land in your own region', () => {
    const g = new Game({ mode: 'versus', seed: 5, players: cpu(2) });
    const s = g.s;
    const obs = obstacleMap(s);
    let mine = -1;
    let theirs = -1;
    let water = -1;
    for (let i = 0; i < s.W * s.H; i++) {
      const x = i % s.W;
      if (x === 0 || x === s.W - 1) continue;
      if (mine < 0 && s.region[i] === 0 && !obs[i]) mine = i;
      if (theirs < 0 && s.region[i] === 1 && !obs[i]) theirs = i;
      if (water < 0 && s.terrain[i] !== LAND) water = i;
    }
    const at = (i: number): [number, number] => [i % s.W, Math.floor(i / s.W)];
    expect(canPlacePiece(s, 0, [[0, 0]], ...at(mine), obs)).toBe(true);
    expect(canPlacePiece(s, 0, [[0, 0]], ...at(theirs), obs)).toBe(false);
    expect(canPlacePiece(s, 0, [[0, 0]], ...at(water), obs)).toBe(false);
    s.crater[mine] = 2;
    expect(canPlacePiece(s, 0, [[0, 0]], ...at(mine), obs)).toBe(false);
    const c = s.castles.find((k) => k.region === 0)!;
    expect(canPlacePiece(s, 0, [[0, 0]], c.x, c.y, obs)).toBe(false);
  });

  it('rejects actions in the wrong phase or with a stale piece number', () => {
    const g = new Game({ mode: 'versus', seed: 9, players: [{ name: 'me', ai: false, difficulty: 'normal' }, ...cpu(1)] });
    expect(g.act(0, { type: 'fire', x: 10, y: 10 })).toBe(false);
    expect(g.act(0, { type: 'cannon', x: 10, y: 10 })).toBe(false);
    runUntil(g, () => g.s.phase === 'build');
    const p = g.s.players[0];
    expect(p.piece).toBeGreaterThanOrEqual(0);
    expect(g.act(0, { type: 'place', x: 0, y: 0, rot: 0, seq: p.pieceSeq + 5 })).toBe(false);
    // A garbage action is ignored rather than crashing the room.
    expect(g.act(0, { type: 'nope' } as never)).toBe(false);
    expect(g.act(7, { type: 'fire', x: 1, y: 1 })).toBe(false);
  });

  it('places a piece, advances the piece queue and claims enclosed castles', () => {
    const g = new Game({ mode: 'versus', seed: 11, players: [{ name: 'me', ai: false, difficulty: 'normal' }, ...cpu(1)] });
    runUntil(g, () => g.s.phase === 'cannons');
    const s = g.s;
    expect(s.players[0].castles).toBe(1);
    expect(s.castles[s.players[0].home].owner).toBe(0);
    expect(s.players[0].cannonsToPlace).toBeGreaterThanOrEqual(2);
  });
});

describe('full games with computer players', () => {
  for (const n of [2, 3, 4]) {
    it(`plays a ${n}-player battle to the end`, () => {
      const g = new Game({ mode: 'versus', seed: 1000 + n, rounds: 4, players: cpu(n) });
      runUntil(g, () => g.s.phase === 'gameover', 1500);
      expect(g.s.phase).toBe('gameover');
      expect(g.s.winner).toBeGreaterThanOrEqual(0);
      expect(g.s.round).toBeLessThanOrEqual(4);
      runUntil(g, () => !!g.s.execution, g.s.time + 10);
      expect(['plank', 'behead']).toContain(g.s.execution);
    });
  }

  it('lets a normal AI defend through several campaign levels', () => {
    const g = new Game({ mode: 'solo', seed: 3, players: cpu(1) });
    runUntil(g, () => g.s.phase === 'gameover' || (g.s.solo?.level ?? 0) >= 3, 1200);
    expect(g.s.solo!.level).toBeGreaterThanOrEqual(3);
    expect(g.s.players[0].alive).toBe(true);
  });
});

describe('network protocol', () => {
  it('keeps a client mirror identical to the server game', () => {
    const g = new Game({ mode: 'versus', seed: 77, rounds: 3, players: cpu(3) });
    const enc = new Encoder(g);
    const mirror = stateFromStatic(encodeStatic(g.s));
    applyTick(mirror, enc.full());
    let checks = 0;
    while (g.s.phase !== 'gameover' && g.s.time < 600) {
      g.tick(TICK);
      applyTick(mirror, enc.delta());
      if (Math.round(g.s.time / TICK) % 40 === 0) {
        checks++;
        expect(Array.from(mirror.wall)).toEqual(Array.from(g.s.wall));
        expect(Array.from(mirror.territory)).toEqual(Array.from(g.s.territory));
        expect(Array.from(mirror.crater)).toEqual(Array.from(g.s.crater).map((c) => Math.min(2, c)));
        expect(mirror.castles.map((c) => c.owner)).toEqual(g.s.castles.map((c) => c.owner));
        expect(mirror.cannons.map((c) => [c.id, c.x, c.y, c.hp, c.active])).toEqual(g.s.cannons.map((c) => [c.id, c.x, c.y, c.hp, c.active]));
        expect(mirror.players.map((p) => [p.score, p.alive, p.piece, p.pieceSeq])).toEqual(g.s.players.map((p) => [p.score, p.alive, p.piece, p.pieceSeq]));
        expect(mirror.phase).toBe(g.s.phase);
      }
    }
    expect(checks).toBeGreaterThan(50);
  });
});

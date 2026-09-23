import { describe, expect, it } from 'vitest';
import { sealingCut } from '../src/shared/ai';
import { ACHIEVEMENTS, TITLES, applyRecord, earnedLook, loadCareer, newCareer, parseRecord, recordFor, validAccountName, validLook } from '../src/shared/career';
import { FACTIONS, FILLS_PER_BUILD, SHIP_FLAGSHIP, TICK, flightTime, levelDef } from '../src/shared/constants';
import { Game, GameConfig } from '../src/shared/engine';
import { generateMap } from '../src/shared/mapgen';
import { PIECE_DEFS, ROTATIONS, UNIQUE_ROTATIONS, pieceCells } from '../src/shared/pieces';
import { Encoder, applyTick, encodeStatic, stateFromStatic } from '../src/shared/protocol';
import { canPlacePiece, computeEnclosed, obstacleMap } from '../src/shared/rules';
import { EXECUTIONS, HATS, LAND, STAT_KEYS, TRAILS, emptyStats } from '../src/shared/types';

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
      expect(EXECUTIONS).toContain(g.s.execution);
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
        expect(mirror.players.map((p) => [p.score, p.alive, p.piece, p.pieceSeq, p.fills, p.faction])).toEqual(
          g.s.players.map((p) => [p.score, p.alive, p.piece, p.pieceSeq, p.fills, p.faction]),
        );
        expect(mirror.phase).toBe(g.s.phase);
      }
    }
    expect(checks).toBeGreaterThan(50);
    // Stats arrive with every phase change, so the final report matches the server's.
    expect(mirror.players.map((p) => p.stats)).toEqual(g.s.players.map((p) => p.stats));
  });

  it('carries each commander\'s cosmetics', () => {
    const look = { title: TITLES[0], hat: 'horns' as const, trail: 'fire' as const };
    const g = new Game({ mode: 'versus', seed: 5, players: [{ name: 'me', ai: false, difficulty: 'normal', look }, ...cpu(1)] });
    const mirror = stateFromStatic(encodeStatic(g.s));
    applyTick(mirror, new Encoder(g).full());
    expect(mirror.players[0].look).toEqual(look);
    expect(mirror.players[1].look).toEqual(validLook(null));
  });
});

describe('game stats', () => {
  it('tallies shots, hits, walls, cannons and land in a battle', () => {
    const g = new Game({ mode: 'versus', seed: 21, rounds: 4, players: cpu(3) });
    runUntil(g, () => g.s.phase === 'gameover', 1500);
    const all = g.s.players.map((p) => p.stats);
    for (const st of all) {
      expect(st.shots).toBeGreaterThan(0);
      expect(st.hits).toBeLessThanOrEqual(st.shots);
      expect(st.cannons).toBeGreaterThanOrEqual(3);
      expect(st.pieces).toBeGreaterThan(0);
      expect(st.maxLand).toBeGreaterThan(0);
      expect(st.maxCastles).toBeGreaterThanOrEqual(1);
      expect(st.walls).toBeLessThanOrEqual(st.hits);
    }
    // Every wall knocked down by a cannon is lost by somebody (there are no grunts in battles).
    const sum = (k: 'walls' | 'wallsLost' | 'cannonsKilled' | 'cannonsLost') => all.reduce((a, st) => a + st[k], 0);
    expect(sum('walls')).toBe(sum('wallsLost'));
    expect(sum('cannonsKilled')).toBe(sum('cannonsLost'));
    expect(sum('walls')).toBeGreaterThan(0);
  });

  it('counts ships sunk against the fleet', () => {
    const g = new Game({ mode: 'solo', seed: 3, players: cpu(1) });
    runUntil(g, () => (g.s.solo?.level ?? 0) >= 2 || g.s.phase === 'gameover', 800);
    const st = g.s.players[0].stats;
    expect(st.ships).toBeGreaterThanOrEqual(g.s.solo!.sunk);
    expect(st.hits).toBeGreaterThanOrEqual(st.ships);
    expect(st.walls).toBe(0);
  });
});

describe('careers and honours', () => {
  const record = (over: Partial<ReturnType<typeof parseRecord> & object> = {}) =>
    parseRecord({ id: 'game-000001', kind: 'battle', difficulty: 'normal', won: true, players: 2, humans: 0, rank: 1, score: 5000, level: 0, rounds: 8, fate: 'tomatoes', stats: emptyStats(), ...over })!;

  it('adds games to the career and awards honours once', () => {
    const c = newCareer();
    expect(applyRecord(c, record())).toContain('victor');
    expect(applyRecord(c, record({ id: 'game-000002' }))).not.toContain('victor');
    expect(c.games).toBe(2);
    expect(c.wins).toBe(2);
    expect(c.modes.battle).toEqual({ played: 2, won: 2, best: 5000, level: 0 });
    expect(c.dealt.tomatoes).toBe(2);
  });

  it('keeps peak stats as bests and sums the rest', () => {
    const c = newCareer();
    applyRecord(c, record({ stats: { ...emptyStats(), shots: 10, maxLand: 90 } }));
    applyRecord(c, record({ stats: { ...emptyStats(), shots: 5, maxLand: 60 } }));
    expect(c.totals.shots).toBe(15);
    expect(c.totals.maxLand).toBe(90);
  });

  it('needs every punishment for Cruel and Unusual, and ten suffered for the fool\'s cap', () => {
    const c = newCareer();
    const got = EXECUTIONS.flatMap((fate, i) => applyRecord(c, record({ id: `game-${i}00000`, fate })));
    expect(got.filter((id) => id === 'merciless')).toHaveLength(1);
    expect(c.honours.merciless).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) applyRecord(c, record({ id: `lost-${i}00000`, won: false, fate: 'dragon' }));
    expect(c.suffered).toBe(10);
    expect(c.honours.glutton).toBeGreaterThan(0);
  });

  it('builds a record from a finished game', () => {
    const g = new Game({ mode: 'versus', seed: 1002, rounds: 3, players: cpu(2, 'hard') });
    runUntil(g, () => !!g.s.execution, 1500);
    const r = recordFor(g.s, g.s.winner, 'battle', 'abcdef-1');
    expect(r.won).toBe(true);
    expect(r.rank).toBe(1);
    expect(r.difficulty).toBe('hard');
    expect(r.fate).toBe(g.s.execution);
    expect(parseRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('rejects malformed records and clamps silly numbers', () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord({ ...record(), kind: 'cheat' })).toBeNull();
    expect(parseRecord({ ...record(), id: 'x' })).toBeNull();
    const r = parseRecord({ ...record(), players: 99, rank: -3, stats: { shots: 5, hits: 50, walls: -4 } })!;
    expect(r.players).toBe(4);
    expect(r.rank).toBe(1);
    expect(r.stats.hits).toBe(5);
    expect(r.stats.walls).toBe(0);
  });

  it('only lets you wear what you have earned', () => {
    const look = { title: 'the Tidy', hat: 'hood', trail: 'fire' };
    expect(earnedLook(look, {})).toEqual({ title: '', hat: 'crown', trail: 'none' });
    expect(earnedLook(look, { spotless: 1, merciless: 1 })).toEqual({ title: 'the Tidy', hat: 'hood', trail: 'none' });
    expect(validLook({ title: 'the Emperor', hat: 'bucket', trail: 'glitter' })).toEqual({ title: '', hat: 'crown', trail: 'none' });
  });

  it('gives every cosmetic a way to be earned', () => {
    for (const h of HATS.filter((x) => x !== 'crown')) expect(ACHIEVEMENTS.some((a) => a.reward.hat === h)).toBe(true);
    for (const t of TRAILS.filter((x) => x !== 'none')) expect(ACHIEVEMENTS.some((a) => a.reward.trail === t)).toBe(true);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('fills in a stored career that is missing newer fields', () => {
    const c = loadCareer({ games: 3, totals: { shots: 7 }, honours: { victor: 5, bogus: 1 } });
    expect(c.games).toBe(3);
    expect(c.totals.shots).toBe(7);
    for (const k of STAT_KEYS) expect(typeof c.totals[k]).toBe('number');
    expect(c.honours).toEqual({ victor: 5 });
    expect(c.modes.online.played).toBe(0);
  });

  it('checks commander names', () => {
    expect(validAccountName('  Sir   Lancelot ')).toBe('Sir Lancelot');
    expect(validAccountName('Åsa')).toBe('Åsa');
    expect(validAccountName('ab')).toBeNull();
    expect(validAccountName('<script>')).toBeNull();
    expect(validAccountName('a'.repeat(17))).toBeNull();
  });
});

describe('cannonball flight', () => {
  it('takes longer the further it flies, and longer in battles than against the fleet', () => {
    expect(flightTime('versus', 20)).toBeGreaterThan(flightTime('versus', 10) * 1.6);
    expect(flightTime('versus', 12)).toBeGreaterThan(flightTime('solo', 12));
    // Even the longest lob lands before the cease-fire wait runs out.
    expect(flightTime('versus', 80)).toBeLessThanOrEqual(6);
  });
});

describe('campaign waves and difficulty', () => {
  const ships = (d: ReturnType<typeof levelDef>) => d.waves.reduce((a, b) => a + b, 0);

  it('scales the fleet with the difficulty setting', () => {
    for (let level = 1; level <= 6; level++) {
      const [easy, normal, hard] = (['easy', 'normal', 'hard'] as const).map((d) => levelDef(level, d));
      expect(ships(easy)).toBeLessThanOrEqual(ships(normal));
      expect(ships(normal)).toBeLessThan(ships(hard));
      expect(easy.fireInterval).toBeGreaterThan(normal.fireInterval);
      expect(hard.fireInterval).toBeLessThan(normal.fireInterval);
      expect(easy.boss).toBe(false);
    }
    expect(levelDef(6, 'normal').boss).toBe(true);
    expect(levelDef(3, 'hard').boss).toBe(true);
  });

  it('keeps getting harder in the endless siege', () => {
    const a = levelDef(7);
    const b = levelDef(15);
    expect(ships(b)).toBeGreaterThan(ships(a));
    expect(b.fireInterval).toBeLessThan(a.fireInterval);
  });

  it('sends the fleet in announced waves and brings out the flagship', () => {
    const g = new Game({ mode: 'solo', seed: 21, campaign: { difficulty: 'hard' }, players: cpu(1, 'hard') });
    const waves: string[] = [];
    let flagship = false;
    while (g.s.phase !== 'gameover' && (g.s.solo?.level ?? 0) <= 3 && g.s.time < 1500) {
      g.tick(TICK);
      for (const e of g.drainEvents()) if (e.e === 'wave') waves.push(`${e.level}.${e.wave}/${e.waves}`);
      if (g.s.ships.some((sh) => sh.kind === SHIP_FLAGSHIP)) flagship = true;
    }
    expect(waves.slice(0, 2)).toEqual(['1.1/2', '1.2/2']);
    expect(waves).toContain('3.3/3');
    expect(flagship).toBe(true);
  });

  it('never runs out of levels in the endless siege', () => {
    const g = new Game({ mode: 'solo', seed: 5, campaign: { difficulty: 'easy', endless: true }, players: cpu(1, 'hard') });
    runUntil(g, () => g.s.phase === 'gameover' || (g.s.solo?.level ?? 0) > 7, 2500);
    expect(g.s.phase).not.toBe('gameover');
    expect(g.s.solo!.level).toBeGreaterThan(7);
  });
});

describe('filling craters', () => {
  function atBuild() {
    const g = new Game({ mode: 'versus', seed: 31, players: [{ name: 'me', ai: false, difficulty: 'normal' }, ...cpu(1)] });
    runUntil(g, () => g.s.phase === 'build');
    const s = g.s;
    const free: number[] = [];
    for (let i = 0; i < s.W * s.H; i++) if (s.region[i] === 0 && s.wall[i] < 0 && !obstacleMap(s)[i] && s.terrain[i] === LAND) free.push(i);
    return { g, s, free };
  }

  it('shovels your own craters flat, a few per build phase', () => {
    const { g, s, free } = atBuild();
    expect(s.players[0].fills).toBe(FILLS_PER_BUILD);
    const holes = free.slice(0, FILLS_PER_BUILD + 1);
    for (const i of holes) s.crater[i] = 2;
    const xy = (i: number) => ({ x: i % s.W, y: Math.floor(i / s.W) });
    for (const i of holes.slice(0, FILLS_PER_BUILD)) {
      expect(g.act(0, { type: 'fill', ...xy(i) })).toBe(true);
      expect(s.crater[i]).toBe(0);
    }
    expect(s.players[0].fills).toBe(0);
    expect(g.act(0, { type: 'fill', ...xy(holes[FILLS_PER_BUILD]) })).toBe(false);
    expect(s.crater[holes[FILLS_PER_BUILD]]).toBe(2);
  });

  it("refuses plain ground, a rival's land and the wrong phase", () => {
    const { g, s, free } = atBuild();
    const xy = (i: number) => ({ x: i % s.W, y: Math.floor(i / s.W) });
    expect(g.act(0, { type: 'fill', ...xy(free[0]) })).toBe(false);
    let theirs = -1;
    for (let i = 0; i < s.W * s.H; i++) if (s.region[i] === 1 && s.wall[i] < 0) theirs = i;
    s.crater[theirs] = 2;
    expect(g.act(0, { type: 'fill', ...xy(theirs) })).toBe(false);
    expect(g.act(0, { type: 'fill', x: 1.5, y: 2 })).toBe(false);
    runUntil(g, () => g.s.phase !== 'build');
    s.crater[free[0]] = 2;
    expect(g.act(0, { type: 'fill', ...xy(free[0]) })).toBe(false);
    expect(s.players[0].fills).toBe(0);
  });

  it('lets the computer use its shovels too', () => {
    const g = new Game({ mode: 'versus', seed: 1004, rounds: 4, players: cpu(4) });
    let fills = 0;
    while (g.s.phase !== 'gameover' && g.s.time < 1500) {
      g.tick(TICK);
      for (const e of g.drainEvents()) if (e.e === 'fill') fills++;
    }
    expect(fills).toBeGreaterThan(0);
  });
});

describe('factions', () => {
  it('keeps chosen factions and gives computer players different ones', () => {
    const g = new Game({
      mode: 'versus',
      seed: 3,
      players: [{ name: 'me', ai: false, difficulty: 'normal', faction: 2 }, ...cpu(3)],
    });
    const f = g.s.players.map((p) => p.faction);
    expect(f[0]).toBe(2);
    expect(new Set(f).size).toBe(4);
    for (const x of f) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(FACTIONS.length);
    }
  });

  it('sanitises a bogus faction', () => {
    const g = new Game({ mode: 'versus', seed: 3, players: [{ name: 'x', ai: true, difficulty: 'normal', faction: 99 }, ...cpu(1)] });
    expect(g.s.players[0].faction).toBe(0);
  });
});

describe("the losers' fate", () => {
  it('lets the winner pick any punishment, but not the losers', () => {
    for (const method of EXECUTIONS) {
      const g = new Game({ mode: 'versus', seed: 8, players: [{ name: 'me', ai: false, difficulty: 'normal' }, { name: 'you', ai: false, difficulty: 'normal' }] });
      (g as unknown as { gameOver(w: number): void }).gameOver(0);
      expect(g.act(1, { type: 'execute', method })).toBe(false);
      expect(g.act(0, { type: 'execute', method: 'boil' as never })).toBe(false);
      expect(g.act(0, { type: 'execute', method })).toBe(true);
      expect(g.s.execution).toBe(method);
    }
  });

  it('has the pirates decide when you lose the campaign, and you decide when you win', () => {
    const lose = new Game({ mode: 'solo', seed: 8, players: [{ name: 'me', ai: false, difficulty: 'normal' }] });
    (lose as unknown as { gameOver(w: number): void }).gameOver(-1);
    expect(lose.act(0, { type: 'execute', method: 'tomatoes' })).toBe(false);
    runUntil(lose, () => !!lose.s.execution, lose.s.time + 5);
    expect(EXECUTIONS).toContain(lose.s.execution);

    const win = new Game({ mode: 'solo', seed: 8, players: [{ name: 'me', ai: false, difficulty: 'normal' }] });
    win.s.solo!.victory = true;
    (win as unknown as { gameOver(w: number): void }).gameOver(0);
    runUntil(win, () => false, win.s.time + 5);
    expect(win.s.execution).toBeNull();
    expect(win.act(0, { type: 'execute', method: 'dragon' })).toBe(true);
  });
});

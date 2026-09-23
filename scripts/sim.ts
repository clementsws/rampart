// Headless AI-vs-AI simulation for balancing: npm run sim -- <solo|versus> <players> <seed>
// Set DRAW=1 to print an ASCII map after every combat and build phase.
import { Game } from '../src/shared/engine';
import { TICK } from '../src/shared/constants';

const mode = (process.argv[2] ?? 'versus') as 'solo' | 'versus';
const n = Number(process.argv[3] ?? 2);
const seed = Number(process.argv[4] ?? 1234);
const g = new Game({
  mode,
  seed,
  rounds: 6,
  players: Array.from({ length: n }, (_, i) => ({ name: `AI${i}`, ai: true, difficulty: 'normal' as const })),
});
const s = g.s;

function draw() {
  const rows: string[] = [];
  for (let y = 0; y < s.H; y++) {
    let r = '';
    for (let x = 0; x < s.W; x++) {
      const i = y * s.W + x;
      const c = s.castles.find((c) => x >= c.x && x <= c.x + 1 && y >= c.y && y <= c.y + 1);
      const cn = s.cannons.find((c) => x >= c.x && x <= c.x + 1 && y >= c.y && y <= c.y + 1);
      if (c) r += c.owner >= 0 ? 'C' : 'c';
      else if (cn) r += cn.active ? 'K' : 'k';
      else if (s.wall[i] >= 0) r += String(s.wall[i]);
      else if (s.crater[i]) r += 'o';
      else if (s.territory[i] >= 0) r += ':';
      else if (s.bonus[i]) r += '$';
      else if (s.terrain[i] === 0) r += '~';
      else r += '.';
    }
    rows.push(r);
  }
  console.log(rows.join('\n'));
}

let lastPhase = '';
let shots = 0;
let hits = 0;
const t0 = Date.now();
let steps = 0;
while (s.phase !== 'gameover' && s.time < 1500) {
  g.tick(TICK);
  steps++;
  for (const e of g.drainEvents()) {
    if (e.e === 'eliminated') console.log(`  t=${s.time.toFixed(1)} player ${e.p} eliminated`);
    if (e.e === 'levelComplete') console.log(`  t=${s.time.toFixed(1)} level ${e.level} complete (shots=${shots} shipHits=${hits})`);
    if (e.e === 'fire' && e.p === 0) shots++;
    if (e.e === 'boom' && e.kind === 'ship') hits++;
  }
  if (s.phase !== lastPhase) {
    lastPhase = s.phase;
    if (s.phase === 'combat' || s.phase === 'summary') {
      console.log(
        `t=${s.time.toFixed(1)} round ${s.round} ${s.phase} lvl=${s.solo?.level ?? '-'} ` +
          s.players.map((p) => `P${p.id}[${p.alive ? 'A' : 'X'} sc=${p.score} cas=${p.castles} ter=${p.territory} can=${s.cannons.filter((c) => c.owner === p.id && c.active).length}]`).join(' '),
      );
    }
    if (process.env.DRAW && (s.phase === 'combat' || s.phase === 'summary')) draw();
  }
}
console.log(`finished at t=${s.time.toFixed(1)} phase=${s.phase} winner=${s.winner} victory=${s.solo?.victory} steps=${steps} in ${Date.now() - t0}ms`);
draw();

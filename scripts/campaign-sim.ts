// Balance check: how computer defenders of each skill fare in the campaign at each fleet difficulty.
// npm run campaign-sim -- [seeds] [endless]
import { Game } from '../src/shared/engine';
import { TICK } from '../src/shared/constants';
import { Difficulty } from '../src/shared/types';

const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
const seeds = Number(process.argv[2] ?? 6);
const endless = process.argv[3] === 'endless';
const only = process.env.SKILL as Difficulty | undefined;
for (const skill of only ? [only] : diffs) {
  for (const fleet of diffs) {
    const res: string[] = [];
    let minC = 0;
    let hits = 0;
    for (let k = 0; k < seeds; k++) {
      const g = new Game({ mode: 'solo', seed: 1000 + k * 37, campaign: { difficulty: fleet, endless }, players: [{ name: 'AI', ai: true, difficulty: skill }] });
      let minCastles = 99;
      let wasSummary = false;
      while (g.s.phase !== 'gameover' && g.s.time < 4000) {
        g.tick(TICK);
        for (const e of g.drainEvents()) if (e.e === 'boom' && (e.kind === 'wall' || e.kind === 'cannon')) hits++;
        if (g.s.phase === 'summary' && !wasSummary) minCastles = Math.min(minCastles, g.s.players[0].castles);
        wasSummary = g.s.phase === 'summary';
      }
      minC += minCastles === 99 ? 0 : minCastles;
      const s = g.s.solo!;
      res.push((s.victory ? 'WIN' : `L${s.level}w${s.wave}`) + `(r${g.s.round})`);
    }
    console.log(`defender=${skill.padEnd(6)} fleet=${fleet.padEnd(6)} ${res.join(' ')} avgMinCastles=${(minC / seeds).toFixed(1)} hitsTaken=${(hits / seeds).toFixed(0)}`);
  }
}

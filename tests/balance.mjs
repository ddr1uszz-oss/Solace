// Balance report: rounds / draw+stand actions per game / % of players losing per round, by table size.
//   node tests/balance.mjs [gamesPerCell]
import { Game } from '../js/engine/game.js';
import { nextAIAction } from '../js/engine/ai.js';
const N = +process.argv[2] || 100;
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (const preset of ['classic', 'fast', 'fair']) {
  console.log(`\n${preset}: players -> rounds / draw+stand / %losing / empty-rune-deck games`);
  for (let n = 2; n <= 10; n++) {
    let rounds = 0, acts = 0, lose = 0, rows = 0, dry = 0;
    for (let k = 0; k < N; k++) {
      const g = new Game({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isAI: true })), seed: n * 1000 + k, config: { preset } });
      const r = rng(k + 1); let guard = 0, wasDry = false;
      const sr = g.startRound.bind(g);                    // all-computer games skip the summary: catch it on the way
      g.startRound = () => { if (g.state.roundResult) for (const x of g.state.roundResult.rows) { rows++; if (!x.winner) lose++; } sr(); };
      while (g.state.phase !== 'gameOver' && guard++ < 30000) {
        if (!g.state.runeDeck.length && !g.state.runeDiscard.length) wasDry = true;
        let acted = false;
        for (const p of g.state.players.filter((x) => x.alive)) {
          const a = nextAIAction(g, p.id, r); if (!a) continue;
          if (a.type === 'draw' || a.type === 'stand') acts++;
          g.dispatch(p.id, a); acted = true; break;
        }
        if (!acted) throw new Error('stuck');
      }
      if (g.state.roundResult) for (const x of g.state.roundResult.rows) { rows++; if (!x.winner) lose++; }
      rounds += g.state.round; if (wasDry) dry++;
    }
    console.log(`  ${n}: ${(rounds / N).toFixed(1)} / ${(acts / N).toFixed(0)} / ${((100 * lose) / rows).toFixed(0)}% / ${dry}`);
  }
}

// AI-only soak test: many full games with random seeds, looking for crashes,
// rejected AI actions, and infinite loops.
import { Game } from '../js/engine/game.js';
import { nextAIAction } from '../js/engine/ai.js';

let games = 0, rounds = 0, actions = 0;
const runeUse = {};
for (let seed = 1; seed <= 300; seed++) {
  const n = 2 + (seed % 9);                      // 2..10 players
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isAI: true }));
  const g = new Game({ players, seed, config: { startingLives: 6, twistPreset: ['off', 'mild', 'wild', 'chaos'][seed % 4], turnTimer: seed % 2 ? 30 : 0, lossFrac: [null, 0.25, 0.5, 1][(seed >> 1) % 4], lossTies: seed % 3 ? 'lose' : 'safe', unitDeckScaling: seed % 5 === 0 ? 'fixed' : 'scaled' } });
  let guard = 0;
  while (g.state.phase !== 'gameOver') {
    if (++guard > 20000) throw new Error('stuck seed ' + seed + ' phase ' + g.state.phase + ' round ' + g.state.round);
    if (guard % 40 === 0 && seed % 3 === 0) { const alive = g.alivePlayers(); if (alive.length > 2) g.eliminate(alive[(seed + guard) % alive.length].id, 'disconnected'); }   // random disconnects
    if (g.state.phase === 'gameOver') break;
    let acted = false;
    for (const p of g.state.players.filter((x) => x.alive)) {
      const a = nextAIAction(g, p.id, mulberry(seed * 7 + guard));
      if (!a) continue;
      if (a.type === 'playRune') runeUse[g.player(p.id).runes.find((r) => r.uid === a.runeUid).runeId] = 1 + (runeUse[g.player(p.id).runes.find((r) => r.uid === a.runeUid).runeId] || 0);
      const r = g.dispatch(p.id, a);
      if (!r.ok) throw new Error(`seed ${seed}: rejected ${JSON.stringify(a)}: ${r.error}`);
      acted = true; actions++; break;
    }
    if (!acted) throw new Error(`seed ${seed}: nobody can act in phase ${g.state.phase}, pending=${JSON.stringify(g.state.pending)}`);
  }
  games++; rounds += g.state.round;
}
console.log(`OK: ${games} games, ${rounds} rounds, ${actions} actions`);
console.log('Runes played by AI:', Object.keys(runeUse).length, 'distinct');
console.log(runeUse);
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

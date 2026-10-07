import assert from 'node:assert/strict';
import { Game } from '../js/engine/game.js';
import { evaluateRound, currentBet, currentTarget } from '../js/engine/rules.js';
import { RUNES, buildRuneDeckList } from '../js/engine/runes.js';

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } }

function mk(n = 3, config = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isAI: false }));
  return new Game({ players, seed: 42, config: { devMode: true, runeDrawChance: 0, ...config } });
}
const setCards = (g, id, vals) => { g.player(id).cards = vals.map((v, i) => ({ uid: 9000 + Math.random() * 1e6 + i, value: v, faceDown: false, revealed: false })); };
const give = (g, id, runeId) => { g.dispatch(id, { type: 'debugGiveRune', runeId }); const r = g.player(id).runes; return r[r.length - 1]; };
const play = (g, id, runeId, params = {}) => { const r = give(g, id, runeId); return g.dispatch(id, { type: 'playRune', runeUid: r.uid, params }); };
const turnOf = (g, id) => { g.state.turn = id; g.player(id).runesThisTurn = 0; };
const standAll = (g) => { for (let i = 0; i < g.alivePlayers().length; i++) g.dispatch(g.state.turn, { type: 'stand' }); };

console.log('Rules');
test('bet starts at 1 and rises every round', () => {
  const g = mk(2);
  assert.equal(currentBet(g.state), 1);
  g.startRound(); assert.equal(currentBet(g.state), 2);
  g.startRound(); assert.equal(currentBet(g.state), 3);
});
test('closest to 21 without busting wins; losers lose the bet', () => {
  const g = mk(3);
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [9, 9]); setCards(g, 'p2', [11, 11]);   // 20, 18, 22(bust)
  const r = evaluateRound(g.state);
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.equal(by.p0.winner, true); assert.equal(by.p0.loss, 0);
  assert.equal(by.p1.loss, 1); assert.equal(by.p2.loss, 1); assert.equal(by.p2.bust, true);
});
test('a bust never beats a non-bust, even if "closer" numerically', () => {
  const g = mk(2);
  setCards(g, 'p0', [11, 11]);       // 22 (distance 1, bust)
  setCards(g, 'p1', [5, 5]);         // 10 (distance 11)
  const r = evaluateRound(g.state);
  assert.equal(r.rows.find((x) => x.id === 'p1').winner, true);
});
test('everyone busts: smallest overshoot wins', () => {
  const g = mk(2);
  setCards(g, 'p0', [11, 11, 1]); setCards(g, 'p1', [11, 11, 5]);
  assert.equal(evaluateRound(g.state).rows.find((x) => x.winner).id, 'p0');
});
test('ties share the win and nobody in the tie loses', () => {
  const g = mk(3);
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [10, 10]); setCards(g, 'p2', [5]);
  const r = evaluateRound(g.state);
  assert.deepEqual(r.rows.map((x) => x.loss), [0, 0, 1]);
});

console.log('Runes');
test('Elevate +1, Elevate II +2, Shield -1, bet floors at 1', () => {
  const g = mk(2); turnOf(g, 'p0');
  assert.equal(play(g, 'p0', 'elevate').ok, true); assert.equal(currentBet(g.state), 2);
  assert.equal(play(g, 'p0', 'elevate2').ok, true); assert.equal(currentBet(g.state), 4);
  const g2 = mk(2); turnOf(g2, 'p0');
  play(g2, 'p0', 'shield2'); assert.equal(currentBet(g2.state), 1);
});
test('New Target changes the win condition; latest wins; Rebuke undoes it', () => {
  const g = mk(2); turnOf(g, 'p0');
  play(g, 'p0', 'target24'); assert.equal(currentTarget(g.state), 24);
  play(g, 'p0', 'target17'); assert.equal(currentTarget(g.state), 17);
  play(g, 'p0', 'rebuke'); assert.equal(currentTarget(g.state), 24);
  const r = evaluateRound(g.state);
  assert.equal(r.target, 24);
});
test('scoring uses the dynamic target', () => {
  const g = mk(2); turnOf(g, 'p0');
  play(g, 'p0', 'target27');
  setCards(g, 'p0', [11, 11, 5]); setCards(g, 'p1', [10, 10]);      // 27 vs 20
  const r = evaluateRound(g.state);
  assert.equal(r.rows.find((x) => x.id === 'p0').winner, true);
});
test('Bless: nobody drops below 1 life this round (other losses still happen)', () => {
  const g = mk(3); turnOf(g, 'p0'); play(g, 'p0', 'bless');
  g.player('p1').lives = 1; g.player('p2').lives = 5;
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [2]); setCards(g, 'p2', [3]);
  const by = Object.fromEntries(evaluateRound(g.state).rows.map((x) => [x.id, x]));
  assert.equal(by.p1.loss, 0);                                   // already at 1: stays there
  assert.equal(by.p2.loss, 1);                                   // can still lose lives above 1
  const h = mk(2); h.state.baseBet = 6; h.player('p1').lives = 4; turnOf(h, 'p0'); play(h, 'p0', 'bless');
  setCards(h, 'p0', [10, 10]); setCards(h, 'p1', [2]);
  assert.equal(evaluateRound(h.state).rows.find((x) => x.id === 'p1').loss, 3);   // 4 lives, bet 6: stops at 1
});
test('Curse: the chosen player loses an additional life this round', () => {
  const g = mk(2); turnOf(g, 'p0'); play(g, 'p0', 'curse', { player: 'p1' });
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [2]);
  assert.equal(evaluateRound(g.state).rows.find((x) => x.id === 'p1').loss, 2);
  setCards(g, 'p0', [2]); setCards(g, 'p1', [10, 10]);           // even a winner pays the extra life
  assert.equal(evaluateRound(g.state).rows.find((x) => x.id === 'p1').loss, 1);
});
test('Wager: win = 2 runes, lose = +1 life', () => {
  const g = mk(2); turnOf(g, 'p0'); play(g, 'p0', 'wager');
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [2]);
  assert.equal(evaluateRound(g.state).rows.find((x) => x.id === 'p0').reward, 2);
  setCards(g, 'p0', [2]); setCards(g, 'p1', [10, 10]);
  assert.equal(evaluateRound(g.state).rows.find((x) => x.id === 'p0').loss, 2);
});
test('Helping Hand: helper takes half of a busted player\u2019s penalty, the player takes the rest', () => {
  const g = mk(3); turnOf(g, 'p0'); play(g, 'p0', 'helping_hand', { player: 'p1' });
  setCards(g, 'p0', [5, 5]); setCards(g, 'p1', [11, 11, 5]); setCards(g, 'p2', [10, 10]);
  let by = Object.fromEntries(evaluateRound(g.state).rows.map((x) => [x.id, x]));
  assert.equal(by.p1.loss, 0); assert.equal(by.p0.loss, 2);       // bet 1: helper takes it (rounded up) on top of own loss 1
  g.state.baseBet = 4;
  by = Object.fromEntries(evaluateRound(g.state).rows.map((x) => [x.id, x]));
  assert.equal(by.p1.loss, 2); assert.equal(by.p0.loss, 4 + 2);   // penalty 4: 2 each
});
test('Jackpot: +3 runes and an extra life lost at round end', () => {
  const g = mk(2); turnOf(g, 'p0'); g.player('p0').runes = [];
  play(g, 'p0', 'jackpot');
  assert.equal(g.player('p0').runes.length, 3); assert.equal(g.player('p0').jackpotTax, 1);
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [2]);
  assert.equal(evaluateRound(g.state).rows.find((x) => x.id === 'p0').loss, 1);
});
test('Restrain blocks normal runes but not Destroy-type', () => {
  const g = mk(2); turnOf(g, 'p0'); play(g, 'p0', 'restrain', { player: 'p1' });
  turnOf(g, 'p1');
  assert.equal(play(g, 'p1', 'elevate').ok, false);
  assert.equal(play(g, 'p1', 'rebuke').ok, true);                // destroys the Restrain
  assert.equal(play(g, 'p1', 'elevate').ok, true);
});
test('Stall: no one can draw unit cards for the next 2 turns', () => {
  const g = mk(4); turnOf(g, 'p0'); play(g, 'p0', 'stall');
  g.dispatch('p0', { type: 'stand' });
  assert.equal(g.state.turn, 'p1');
  assert.equal(g.dispatch('p1', { type: 'draw' }).ok, false);     // turn 1
  assert.equal(play(g, 'p1', 'twin_draw').ok, false);
  g.dispatch('p1', { type: 'stand' });
  assert.equal(g.state.turn, 'p2');
  assert.equal(g.dispatch('p2', { type: 'draw' }).ok, false);     // turn 2
  g.dispatch('p2', { type: 'stand' });
  assert.equal(g.state.turn, 'p3');
  assert.equal(g.isStalled(), false);                             // spent: turn 3 can draw
  assert.equal(g.dispatch('p3', { type: 'draw' }).ok, true);
});
test('Mischief returns one of your own active runes to your hand (and its effect ends)', () => {
  const g = mk(2); turnOf(g, 'p0'); play(g, 'p0', 'elevate');
  assert.equal(currentBet(g.state), 2);
  const uid = g.state.active[0].uid, n = g.player('p0').runes.length;
  assert.equal(play(g, 'p0', 'mischief', { ownActive: uid }).ok, true);
  assert.equal(g.state.active.length, 0); assert.equal(currentBet(g.state), 1);
  assert.equal(g.player('p0').runes.length, n + 1);
  assert.ok(g.player('p0').runes.some((r) => r.uid === uid && r.runeId === 'elevate'));
  turnOf(g, 'p1'); const r = give(g, 'p1', 'mischief');
  assert.ok(g.dispatch('p1', { type: 'playRune', runeUid: r.uid, params: {} }).error);   // nothing of your own to take back
  const rs = mk(2); turnOf(rs, 'p0'); play(rs, 'p0', 'elevate'); turnOf(rs, 'p0'); play(rs, 'p0', 'restrain', { player: 'p1' });
  turnOf(rs, 'p1'); assert.equal(RUNES.mischief.destroy, undefined);
});
test('Unity: you draw 2 rune cards, everyone else draws 1', () => {
  const g = mk(3); turnOf(g, 'p0'); for (const p of g.state.players) p.runes = [];
  play(g, 'p0', 'unity');
  assert.equal(g.player('p0').runes.length, 2); assert.equal(g.player('p1').runes.length, 1); assert.equal(g.player('p2').runes.length, 1);
});
test('Exile: vote resolves, target skips draw and discards a rune', () => {
  const g = mk(3); turnOf(g, 'p0'); play(g, 'p0', 'exile');
  assert.equal(g.state.pending.kind, 'vote');
  g.player('p1').runes = [{ uid: 1, runeId: 'elevate' }];
  for (const id of ['p0', 'p1', 'p2']) g.dispatch(id, { type: 'vote', target: 'p1' === id ? 'p2' : 'p1' });
  assert.equal(g.state.pending, null);
  assert.ok(g.player('p1').skipDraw || g.player('p2').skipDraw);
  assert.equal(g.dispatch('p0', { type: 'vote', target: 'p1' }).ok, false);
});
test('Double Draw: draw two, keep one, the other returns to the deck', () => {
  const g = mk(2); turnOf(g, 'p0'); play(g, 'p0', 'double_draw');
  const before = g.player('p0').cards.length, deck = g.state.unitDeck.length;
  g.dispatch('p0', { type: 'draw' });
  assert.equal(g.state.pending.kind, 'pick');
  assert.equal(g.getView('p1').pending.cards, null);              // opponent can\u2019t see the options
  const pick = g.state.pending.cards[0];
  assert.equal(g.dispatch('p0', { type: 'pick', cardUid: pick.uid }).ok, true);
  assert.equal(g.player('p0').cards.length, before + 1);
  assert.equal(g.state.unitDeck.length, deck - 1);
  assert.equal(g.state.turn, 'p1');
});
test('Prophecy reveals a face-down card to everyone', () => {
  const g = mk(2); turnOf(g, 'p0');
  assert.equal(g.getView('p0').players.find((p) => p.id === 'p1').cards.some((c) => c.value === null), true);
  play(g, 'p0', 'prophecy', { player: 'p1' });
  assert.equal(g.getView('p0').players.find((p) => p.id === 'p1').cards.every((c) => c.value !== null), true);
});
test('Barter swaps latest cards; Remove removes the latest card', () => {
  const g = mk(2); turnOf(g, 'p0');
  setCards(g, 'p0', [3, 4]); setCards(g, 'p1', [5, 6]);
  play(g, 'p0', 'barter', { player: 'p1' });
  assert.deepEqual(g.player('p0').cards.map((c) => c.value), [3, 6]);
  assert.deepEqual(g.player('p1').cards.map((c) => c.value), [5, 4]);
  play(g, 'p0', 'remove', { player: 'p1' });
  assert.deepEqual(g.player('p1').cards.map((c) => c.value), [5]);
});
test('Gambit: +1 bet and draws a rune', () => {
  const g = mk(2); turnOf(g, 'p0'); const n = g.player('p0').runes.length;
  play(g, 'p0', 'gambit');
  assert.equal(currentBet(g.state), 2); assert.equal(g.player('p0').runes.length, n + 1);
});
test('Trade swaps a rune with a random rune from the target', () => {
  const g = mk(2); turnOf(g, 'p0');
  g.player('p0').runes = []; g.player('p1').runes = [{ uid: 777, runeId: 'bless' }];
  const mine = give(g, 'p0', 'elevate'); play(g, 'p0', 'trade', { player: 'p1', ownRune: mine.uid });
  assert.equal(g.player('p0').runes[0].runeId, 'bless'); assert.equal(g.player('p1').runes[0].runeId, 'elevate');
});

console.log('Flow');
test('round ends when everyone stands in a row; draws reset the count', () => {
  const g = mk(3); const r = g.state.round;
  g.dispatch(g.state.turn, { type: 'stand' });
  g.dispatch(g.state.turn, { type: 'draw' });
  g.dispatch(g.state.turn, { type: 'stand' }); g.dispatch(g.state.turn, { type: 'stand' });
  assert.equal(g.state.phase, 'turn');
  g.dispatch(g.state.turn, { type: 'stand' });
  assert.equal(g.state.phase, 'roundEnd'); assert.equal(g.state.round, r);
});
test('next round starts once every human is ready; bet grows; hands reset', () => {
  const g = mk(2); standAll(g);
  assert.equal(g.state.phase, 'roundEnd');
  g.dispatch('p0', { type: 'ready' }); assert.equal(g.state.phase, 'roundEnd');
  g.dispatch('p1', { type: 'ready' });
  assert.equal(g.state.phase, 'turn'); assert.equal(g.state.round, 2); assert.equal(currentBet(g.state), 2);
  assert.ok(g.alivePlayers().every((p) => p.cards.length === 2));
});
test('players can only act on their own turn; others\u2019 hidden cards stay hidden', () => {
  const g = mk(3); const other = g.state.players.find((p) => p.id !== g.state.turn).id;
  assert.equal(g.dispatch(other, { type: 'draw' }).ok, false);
  const v = g.getView('p0');
  for (const p of v.players.filter((x) => x.id !== 'p0')) assert.equal(p.cards.filter((c) => c.value === null).length, 1);
  assert.equal(v.players[0].runes.length > 0, true);
  assert.equal(v.players[1].runes, undefined);
});
test('game ends when one player is left', () => {
  const g = mk(2, { startingLives: 1 });
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [2]);
  standAll(g);
  assert.equal(g.state.phase, 'gameOver'); assert.equal(g.state.winnerId, 'p0');
});
test('state survives JSON round-trip (server/restore ready)', () => {
  const g = mk(3); g.dispatch(g.state.turn, { type: 'draw' });
  const g2 = Game.fromState(JSON.parse(JSON.stringify(g.state)));
  assert.deepEqual(g2.getView('p0'), g.getView('p0'));
  g.dispatch(g.state.turn, { type: 'draw' }); g2.dispatch(g2.state.turn, { type: 'draw' });
  assert.deepEqual(g2.state, g.state);                              // RNG state is part of the state
});
test('up to 10 players, deck scales', () => {
  const g = mk(10);
  assert.equal(g.alivePlayers().length, 10);
  assert.equal(g.state.unitDeck.length + 20, 55);                   // 5 copies of 1\u201311
  assert.throws(() => mk(11));
});


console.log('Events & helpers (used by the UI)');
test('draw, stand and rune plays are tagged with structured events', () => {
  const g = mk(2); turnOf(g, 'p0');
  g.dispatch('p0', { type: 'draw' });
  turnOf(g, 'p1'); g.dispatch('p1', { type: 'stand' });
  turnOf(g, 'p0'); const r = give(g, 'p0', 'elevate'); g.dispatch('p0', { type: 'playRune', runeUid: r.uid, params: {} });
  const evs = g.getView('p0').log.map((l) => l.ev).filter(Boolean);
  assert.deepEqual(evs.map((e) => e.t), ['roundStart', 'draw', 'stand', 'rune']);
  const rune = evs.find((e) => e.t === 'rune');
  assert.equal(rune.runeId, 'elevate'); assert.equal(rune.kind, 'active'); assert.equal(rune.uid, r.uid);
});
test('round end is tagged and the view exposes a bust-risk estimate', () => {
  const g = mk(2);
  const v = g.getView('p0');
  assert.ok(v.risk >= 0 && v.risk <= 1);
  setCards(g, 'p0', [11, 10]);                       // 21: any draw busts
  assert.equal(g.getView('p0').risk, 1);
  standAll(g);
  assert.ok(g.getView('p0').log.some((l) => l.ev && l.ev.t === 'roundEnd'));
});

console.log('New cards, direction, timer view, rune-on-draw');
const ids = (g) => g.alivePlayers().map((p) => p.id);
test('direction: clockwise / counter-clockwise / alternate', () => {
  const g = mk(4, { turnDirection: 'alternate' });
  assert.equal(g.state.dir, 1); assert.equal(g.state.turn, 'p0');
  g.dispatch('p0', { type: 'draw' }); assert.equal(g.state.turn, 'p1');
  g.startRound(); assert.equal(g.state.dir, -1); assert.equal(g.state.turn, 'p1');      // first player rotates
  g.dispatch('p1', { type: 'draw' }); assert.equal(g.state.turn, 'p0');                 // counter-clockwise
  g.startRound(); assert.equal(g.state.dir, 1);
  const c = mk(3, { turnDirection: 'ccw' }); assert.equal(c.state.dir, -1);
  c.dispatch('p0', { type: 'draw' }); assert.equal(c.state.turn, 'p2');
  c.startRound(); assert.equal(c.state.dir, -1);
  const f = mk(3, { turnDirection: 'cw' }); f.startRound(); assert.equal(f.state.dir, 1);
});
test('Reverse flips direction once per round and needs 3+ players', () => {
  const g = mk(3, { turnDirection: 'cw' }); turnOf(g, 'p0');
  assert.equal(play(g, 'p0', 'reverse').ok, true); assert.equal(g.state.dir, -1);
  const r = give(g, 'p0', 'reverse');
  assert.match(g.dispatch('p0', { type: 'playRune', runeUid: r.uid, params: {} }).error, /Already reversed/);
  g.dispatch('p0', { type: 'draw' }); assert.equal(g.state.turn, 'p2');
  const two = mk(2); turnOf(two, 'p0');
  assert.match(play(two, 'p0', 'reverse').error, /3 players/);
});
test('Vow: auto-stands for 3 turns, untargetable, ends after that; can be destroyed', () => {
  const g = mk(3, { defaultTarget: 99 });   // high target: the many draws below must not bust anyone
  turnOf(g, 'p0'); assert.equal(play(g, 'p0', 'vow').ok, true);
  assert.equal(g.state.turn, 'p0');                               // casting does not end your turn
  const v = g.getView('p1').players[0]; assert.equal(v.vowed, true); assert.equal(v.vowLeft, 3);
  turnOf(g, 'p1'); const r = give(g, 'p1', 'dread');
  assert.ok(g.dispatch('p1', { type: 'playRune', runeUid: r.uid, params: { player: 'p0' } }).error);   // can't be targeted
  turnOf(g, 'p0'); g.dispatch('p0', { type: 'draw' });
  assert.equal(g.state.turn, 'p1');
  g.dispatch('p1', { type: 'draw' }); g.dispatch('p2', { type: 'draw' });
  assert.equal(g.state.turn, 'p1'); assert.equal(g.getView('p1').players[0].vowLeft, 2);   // p0 stood automatically
  g.dispatch('p1', { type: 'draw' }); g.dispatch('p2', { type: 'draw' });
  assert.equal(g.state.turn, 'p1'); assert.equal(g.getView('p1').players[0].vowLeft, 1);
  g.dispatch('p1', { type: 'draw' }); g.dispatch('p2', { type: 'draw' });
  assert.equal(g.state.turn, 'p1'); assert.equal(g.isVowed(g.player('p0')), false);          // third stand used it up
  assert.ok(!g.state.active.some((a) => a.runeId === 'vow'));
  g.dispatch('p1', { type: 'draw' }); g.dispatch('p2', { type: 'draw' });
  assert.equal(g.state.turn, 'p0');                               // p0 plays normally again
  const h = mk(3); turnOf(h, 'p0'); play(h, 'p0', 'vow'); turnOf(h, 'p1');
  assert.equal(play(h, 'p1', 'rebuke').ok, true); assert.equal(h.isVowed(h.player('p0')), false);
});
test('Vow: auto-stands count toward ending the round', () => {
  const g = mk(2); turnOf(g, 'p0'); play(g, 'p0', 'vow'); g.dispatch('p0', { type: 'stand' });
  g.dispatch('p1', { type: 'stand' });                            // p0 auto-stands, so everyone has now stood in a row
  assert.equal(g.state.phase, 'roundEnd');
});
test('Vow keeps players out of Exile votes', () => {
  const g = mk(3); turnOf(g, 'p0'); play(g, 'p0', 'vow'); turnOf(g, 'p1');
  assert.equal(play(g, 'p1', 'exile').ok, true);
  assert.deepEqual(g.state.pending.candidates, ['p2']);
});
test('Wrap: finish your turn, everyone else gets one turn, no runes, then the round ends', () => {
  const g = mk(4); turnOf(g, 'p0'); assert.equal(play(g, 'p0', 'wrap').ok, true);
  assert.equal(g.state.phase, 'turn'); g.dispatch('p0', { type: 'draw' });
  const r = give(g, 'p1', 'elevate');
  assert.match(g.dispatch('p1', { type: 'playRune', runeUid: r.uid, params: {} }).error, /Wrap/);
  g.dispatch('p1', { type: 'draw' }); g.dispatch('p2', { type: 'stand' });
  assert.equal(g.state.phase, 'turn'); g.dispatch('p3', { type: 'draw' });
  assert.equal(g.state.phase, 'roundEnd');
  assert.equal(g.getView('p0').lastCall, null);
});
test('Underdog: draws 2 only for the player with the fewest lives (ties count, all tied = nothing)', () => {
  const g = mk(3); turnOf(g, 'p0');
  const n0 = g.player('p0').runes.length; play(g, 'p0', 'underdog');
  assert.equal(g.player('p0').runes.length, n0);                      // everyone tied
  g.player('p0').lives = 3; turnOf(g, 'p0'); const n1 = g.player('p0').runes.length; play(g, 'p0', 'underdog');
  assert.equal(g.player('p0').runes.length, n1 + 2);
  g.player('p1').lives = 3; turnOf(g, 'p1'); const m = g.player('p1').runes.length; play(g, 'p1', 'underdog');
  assert.equal(g.player('p1').runes.length, m + 2);                   // tie for fewest still counts
  turnOf(g, 'p2'); const k = g.player('p2').runes.length; play(g, 'p2', 'underdog');
  assert.equal(g.player('p2').runes.length, k);
});
test('normal draws can hand out a rune (runeDrawChance), never over the hand limit', () => {
  const g = mk(2, { runeDrawChance: 1 }); turnOf(g, 'p0');
  const n = g.player('p0').runes.length; g.dispatch('p0', { type: 'draw' });
  assert.equal(g.player('p0').runes.length, n + 1);
  assert.equal(g.state.log.filter((l) => l.ev && l.ev.t === 'draw').pop().ev.rune, 1);
  const full = mk(2, { runeDrawChance: 1 }); turnOf(full, 'p0');
  while (full.player('p0').runes.length < 6) give(full, 'p0', 'elevate');
  full.dispatch('p0', { type: 'draw' }); assert.equal(full.player('p0').runes.length, 6);
  const none = mk(2, { runeDrawChance: 0 }); const m = none.player('p0').runes.length; none.dispatch('p0', { type: 'draw' });
  assert.equal(none.player('p0').runes.length, m);
});
test('the rune deck is exactly the 37 cards in the card file, with the right copies', () => {
  const g = mk(2); const all = [...g.state.runeDeck, ...g.state.players.flatMap((p) => p.runes)];
  assert.equal(Object.keys(RUNES).length, 37);
  for (const gone of ['ward', 'lockin', 'lastcall']) assert.equal(RUNES[gone], undefined);
  for (const added of ['vow', 'wrap']) assert.ok(RUNES[added]);
  assert.equal(all.length, Object.values(RUNES).reduce((t, r) => t + r.copies, 0));
});
test('Underdog helps whoever has the fewest lives, even the opponent', () => {
  const g = mk(3); turnOf(g, 'p0'); g.player('p1').lives = 2;
  const a = g.player('p0').runes.length, b = g.player('p1').runes.length; play(g, 'p0', 'underdog');
  assert.equal(g.player('p0').runes.length, a); assert.equal(g.player('p1').runes.length, b + 2);
});

console.log(`\n${passed} passed`);

console.log('Visibility options');
test('showLives off: you only see your own lives (everyone\u2019s once the game is over)', () => {
  const g = mk(3, { showLives: false }); g.player('p1').lives = 4;
  const v = g.getView('p0');
  assert.equal(v.players.find((p) => p.id === 'p0').lives, 10);
  assert.equal(v.players.find((p) => p.id === 'p1').lives, null);
  assert.equal(v.config.showLives, false);
  g.state.phase = 'gameOver';
  assert.equal(g.getView('p0').players.find((p) => p.id === 'p1').lives, 4);
  assert.equal(mk(2).getView('p0').players[1].lives, 10);        // default: visible
});
test('showLives off: round results hide other players\u2019 lives totals', () => {
  const g = mk(2, { showLives: false }); setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [2]); g.dispatch('p0', { type: 'stand' }); g.dispatch('p1', { type: 'stand' });
  assert.equal(g.state.phase, 'roundEnd');
  const rows = g.getView('p0').roundResult.rows;
  assert.equal(rows.find((r) => r.id === 'p1').livesBefore, null);
  assert.equal(typeof rows.find((r) => r.id === 'p0').livesBefore, 'number');
  assert.equal(typeof g.state.roundResult.rows[1].livesBefore, 'number');   // the server keeps the truth
});
test('showDirection off: the view never reveals the turn direction', () => {
  const g = mk(4, { showDirection: false, turnDirection: 'ccw' });
  assert.equal(g.state.dir, -1); assert.equal(g.getView('p0').dir, 1); assert.equal(g.getView('p0').config.showDirection, false);
  assert.equal(mk(4, { turnDirection: 'ccw' }).getView('p0').dir, -1);   // default: shown
  const r = mk(4, { showDirection: false }); turnOf(r, 'p0'); play(r, 'p0', 'reverse');
  assert.equal(r.state.dir, -1); assert.equal(r.getView('p0').reversed, false);   // the game still reverses, the view doesn't say
});

console.log('Round twists');
import { rollTwist, TWISTS, TWIST_PRESETS } from '../js/engine/twists.js';
import { Rng } from '../js/engine/rng.js';
const withTwist = (g, t) => { g.state.nextTwist = t; g.startRound(); return g; };
test('twists are off by default and never roll with the Off preset', () => {
  const g = mk(2); assert.equal(g.state.twist, null); assert.equal(g.state.nextTwist, null);
  for (let i = 0; i < 30; i++) { standAll(g); g.dispatch('p0', { type: 'ready' }); g.dispatch('p1', { type: 'ready' }); assert.equal(g.state.twist, null); }
});
test('presets: Chaos rolls from round 1, Mild only the gentle twists, nothing repeats back to back', () => {
  const rng = new Rng({ s: 7 });
  let seen = new Set(), prev = null, hit = 0;
  for (let i = 0; i < 400; i++) { const t = rollTwist({ twistPreset: 'chaos', turnTimer: 30 }, 1, rng, prev); if (t) { assert.notEqual(t.id, prev); seen.add(t.id); hit++; } prev = t ? t.id : null; }
  assert.equal(seen.size, 6); assert.ok(hit > 250);
  seen = new Set();
  for (let i = 0; i < 400; i++) { const t = rollTwist({ twistPreset: 'mild', turnTimer: 30 }, 5, rng, null); if (t) seen.add(t.id); }
  assert.deepEqual([...seen].sort(), [...TWIST_PRESETS.mild.ids].sort());
  assert.equal(rollTwist({ twistPreset: 'mild' }, 1, rng, null), null);          // not before round 2
});
test('Speed Round is only offered when turn timers are on, and shrinks the timer', () => {
  const rng = new Rng({ s: 3 });
  for (let i = 0; i < 300; i++) { const t = rollTwist({ twistPreset: 'chaos', turnTimer: 0 }, 2, rng, null); assert.ok(!t || t.id !== 'rush'); }
  const g = mk(2, { turnTimer: 60 }); assert.equal(g.turnSecs(), 60);
  withTwist(g, { id: 'rush', name: 'Speed Round', icon: 'x', desc: 'd', timer: 20 }); assert.equal(g.turnSecs(), 20);
  assert.equal(mk(2).turnSecs(), 0);
});
test('Shifted Target changes the win condition; a New Target rune still overrides it', () => {
  const g = withTwist(mk(2), { id: 'target', name: 'Shifted Target', icon: 'x', desc: 'd', target: 17 });
  assert.equal(currentTarget(g.state), 17); assert.equal(g.getView('p0').target, 17);
  turnOf(g, 'p0'); play(g, 'p0', 'target24'); assert.equal(currentTarget(g.state), 24);
});
test('High Stakes doubles the bet (after rune modifiers)', () => {
  const g = withTwist(mk(2), { id: 'double', name: 'High Stakes', icon: 'x', desc: 'd', betMult: 2 });
  const base = currentBet(g.state); assert.equal(base, 2 * g.state.baseBet);
  turnOf(g, 'p0'); play(g, 'p0', 'elevate'); assert.equal(currentBet(g.state), (g.state.baseBet + 1) * 2);
});
test('Tight Grip: 1 rune per turn and a smaller rune hand limit', () => {
  const g = withTwist(mk(2), { id: 'grip', name: 'Tight Grip', icon: 'x', desc: 'd', maxRunes: 1, handLimit: 3 });
  assert.equal(g.maxRunes(), 1); assert.equal(g.getView('p0').config.maxRunesPerTurn, 1); assert.equal(g.getView('p0').config.runeHandLimit, 3);
  turnOf(g, 'p0'); play(g, 'p0', 'elevate');
  const r = give(g, 'p0', 'shield'); assert.match(g.dispatch('p0', { type: 'playRune', runeUid: r.uid, params: {} }).error, /Max 1 rune/);
  g.player('p1').runes = [1, 2, 3].map((n) => ({ uid: 7000 + n, runeId: 'elevate' }));
  assert.equal(g.drawRune(g.player('p1'), 2), 0);                                  // already at the limit
});
test('Rune Rain: everyone starts the round with extra runes', () => {
  const plain = mk(2); const rain = withTwist(mk(2), { id: 'rain', name: 'Rune Rain', icon: 'x', desc: 'd', extraRunes: 2 });
  assert.equal(rain.player('p0').runes.length, plain.player('p0').runes.length + 2 + 1);   // + this round\u2019s normal rune (round 2)
});
test('Rare Tide: drawn runes skew to higher tiers', () => {
  const avg = (twist) => {
    let t = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = new Game({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed, config: { runeDrawChance: 0, runeHandLimit: 99 } });
      g.state.twist = twist; g.player('a').runes = [];
      g.drawRune(g.player('a'), 12); for (const r of g.player('a').runes) { t += RUNES[r.runeId].tier; n++; }
    }
    return t / n;
  };
  assert.ok(avg({ rarity: 'high' }) > avg(null) + 0.15);
});
test('twist is announced in the log/event, shown in the view, and the next one is teased at round end', () => {
  const g = mk(2, { twistPreset: 'chaos' });
  g.state.nextTwist = { id: 'double', name: 'High Stakes', icon: 'x', desc: 'The bet is doubled this round.', betMult: 2 }; g.startRound();
  const ev = g.state.log.filter((l) => l.ev && l.ev.t === 'roundStart').pop().ev;
  assert.equal(ev.twist.id, 'double'); assert.equal(g.getView('p0').twist.name, 'High Stakes');
  assert.ok(g.state.log.some((l) => l.big && /Twist: High Stakes/.test(l.text)));
  assert.equal(g.getView('p0').nextTwist, null);                                     // not shown mid-round
  g.state.nextTwist = null; standAll(g);
  assert.equal(g.state.phase, 'roundEnd');
  const nxt = g.state.nextTwist;
  assert.deepEqual(g.getView('p0').nextTwist, nxt ? { id: nxt.id, name: nxt.name, icon: nxt.icon, desc: nxt.desc } : null);
  g.state.nextTwist = { id: 'rain', name: 'Rune Rain', icon: 'x', desc: 'd', extraRunes: 2 };
  g.dispatch('p0', { type: 'ready' }); g.dispatch('p1', { type: 'ready' });
  assert.equal(g.state.twist.id, 'rain');
});
test('twist state survives a JSON round-trip', () => {
  const g = withTwist(mk(2), { id: 'target', name: 'Shifted Target', icon: 'x', desc: 'd', target: 24 });
  const h = Game.fromState(JSON.parse(JSON.stringify(g.state)));
  assert.equal(currentTarget(h.state), 24); assert.equal(h.getView('p0').twist.id, 'target');
});

test('Restrain, Wrap, Duel, Bless, Exile and Jackpot are the special (tier 4, single-copy) runes', () => {
  for (const id of ['restrain', 'wrap', 'duel', 'bless', 'exile', 'jackpot']) { assert.equal(RUNES[id].tier, 4, id); assert.equal(RUNES[id].copies, 1, id); }
});

test('runeHandLimit is a table option; Tight Grip can only tighten it', () => {
  const g = mk(2, { runeHandLimit: 3 }); const p = g.player('p0'); p.runes = [];
  assert.equal(g.drawRune(p, 10), 3); assert.equal(g.getView('p0').config.runeHandLimit, 3);
  const h = mk(2, { runeHandLimit: 2 }); h.state.twist = { handLimit: 3 }; assert.equal(h.handLimit(), 2);
  assert.equal(mk(2).handLimit(), 6);
});

// ------------------------------------------------------------- scaling, scoring, disconnects
console.log('Scaling, fraction scoring, elimination');
const unitCount = (g) => g.state.unitDeck.length + g.alivePlayers().length * 2;       // deck + the 2 dealt to each player
test('unit deck: 1v1 is one copy of 1-11, more players add copies (all configurable)', () => {
  assert.equal(unitCount(mk(2)), 11);
  assert.equal(unitCount(mk(3)), 22); assert.equal(unitCount(mk(4)), 22); assert.equal(unitCount(mk(5)), 33);
  assert.equal(unitCount(mk(6, { playersPerDeck: 3 })), 22);                          // 1 extra set per 3 players
  assert.equal(unitCount(mk(8, { maxUnitCopies: 2 })), 22);                           // capped
  assert.equal(unitCount(mk(2, { minUnitCopies: 2 })), 22);                           // floor
  assert.equal(unitCount(mk(9, { unitDeckScaling: 'fixed', unitCopies: 3 })), 33);    // fixed, ignores table size
});
test('rune deck: auto doubles at 8-10 players, or use a fixed multiplier', () => {
  const total = (g) => g.state.runeDeck.length + g.state.players.reduce((t, p) => t + p.runes.length, 0);
  const base = Object.values(RUNES).reduce((t, r) => t + r.copies, 0);
  assert.equal(total(mk(7)), base); assert.equal(total(mk(8)), base * 2); assert.equal(total(mk(10)), base * 2);
  assert.equal(total(mk(3, { runeDeckMultiplier: 2 })), base * 2);
  assert.equal(total(mk(10, { runeDeckMultiplier: 1 })), base);
  assert.equal(mk(8, { runeDeckAuto: [[5, 3]] }).runeDeckMult(8), 3);
});
const lossOf = (vals, cfg = {}, bet = 1) => {
  const g = mk(vals.length, { lossFrac: 0.5, ...cfg });
  vals.forEach((v, i) => setCards(g, 'p' + i, [v]));                                   // target 21: totals are the values
  g.state.baseBet = bet;
  return evaluateRound(g.state).rows.map((r) => r.loss);
};
test('lossFrac: the worst fraction of the table loses the bet', () => {
  assert.deepEqual(lossOf([20, 18, 15, 10]), [0, 0, 1, 1]);                            // half of 4
  assert.deepEqual(lossOf([20, 18, 15, 10], { lossFrac: 0.25 }), [0, 0, 0, 1]);
  assert.deepEqual(lossOf([20, 18, 15, 10], { lossFrac: 1 }), [1, 1, 1, 1]);
  assert.deepEqual(lossOf([20, 18, 15, 10], { lossFrac: 0 }), [0, 0, 0, 0]);
  assert.deepEqual(lossOf([20, 18, 15], { lossFrac: 0.5 }), [0, 1, 1]);                // 1.5 rounds up to 2
  assert.deepEqual(lossOf([20, 18, 15], { lossFrac: 0.5, lossRounding: 'floor' }), [0, 0, 1]);
  assert.deepEqual(lossOf([20, 18, 15, 10], {}, 3), [0, 0, 3, 3]);                      // loses equal the bet
});
test('lossFrac: busted players rank worst; ties at the cutoff all lose; all tied = nobody loses', () => {
  assert.deepEqual(lossOf([25, 20, 19, 5]), [1, 0, 0, 1]);                              // bust and a big miss are the worst two
  assert.deepEqual(lossOf([22, 23, 20, 19], { lossFrac: 0.25 }), [0, 1, 0, 0]);         // 23 busts by more than 22
  assert.deepEqual(lossOf([20, 15, 15, 10]), [0, 1, 1, 1]);                             // 15s tie at the cutoff and both lose, the 10 too
  assert.deepEqual(lossOf([20, 15, 15, 10], { lossTies: 'safe' }), [0, 0, 0, 1]);
  assert.deepEqual(lossOf([20, 15, 15, 15], { lossFrac: 0.25, lossTies: 'safe' }), [0, 1, 1, 1]);   // sparing the tie would leave no loser, so the tie loses
  assert.deepEqual(lossOf([18, 18, 18]), [0, 0, 0]);
  assert.deepEqual(lossOf([30, 30], { lossFrac: 0.5 }), [0, 0]);
});
test('lossFrac null keeps classic scoring (only the closest are safe, ties share)', () => {
  const g = mk(4); [20, 20, 15, 10].forEach((v, i) => setCards(g, 'p' + i, [v]));
  assert.deepEqual(evaluateRound(g.state).rows.map((r) => r.loss), [0, 0, 1, 1]);
  assert.deepEqual(evaluateRound(g.state).rows.map((r) => r.safe), [true, true, false, false]);
});
test('fraction scoring runs end to end and flags safe players who were not closest', () => {
  const g = mk(4, { lossFrac: 0.5 }); [20, 18, 15, 10].forEach((v, i) => setCards(g, 'p' + i, [v]));
  standAll(g);
  const rows = g.state.roundResult.rows;
  assert.deepEqual(rows.map((r) => [r.winner, r.safe, r.livesAfter]), [[true, true, 10], [false, true, 10], [false, false, 9], [false, false, 9]]);
});
test('eliminate: the current player is removed and the turn moves on', () => {
  const g = mk(3); const first = g.state.turn;
  assert.equal(g.eliminate(first, 'disconnected'), true);
  assert.equal(g.player(first).alive, false); assert.equal(g.player(first).lives, 0);
  assert.notEqual(g.state.turn, first); assert.ok(g.player(g.state.turn).alive);
  assert.equal(g.eliminate(first), false);                                              // already out
  g.dispatch(g.state.turn, { type: 'stand' });                                          // the game keeps going
  assert.equal(g.state.phase === 'turn' || g.state.phase === 'roundEnd', true);
});
test('eliminate: the last player standing wins; others waiting on the table do not stall the round', () => {
  const g = mk(2); g.eliminate('p1');
  assert.equal(g.state.phase, 'gameOver'); assert.equal(g.state.winnerId, 'p0');
  const h = mk(3); h.dispatch(h.state.turn, { type: 'stand' }); h.dispatch(h.state.turn, { type: 'stand' });
  const last = h.state.turn; const other = h.alivePlayers().find((p) => p.id !== last).id;
  h.eliminate(other);                                                                   // both others had stood: now everyone left has stood or is up
  assert.ok(h.state.phase === 'turn' ? h.state.turn === last : true);
});
test('eliminate: the round-end ready check and a pending pick/vote do not wait for the player', () => {
  const g = mk(3); standAll(g); assert.equal(g.state.phase, 'roundEnd');
  g.dispatch('p0', { type: 'ready' }); g.dispatch('p1', { type: 'ready' });
  g.eliminate('p2'); assert.equal(g.state.phase, 'turn'); assert.equal(g.state.round, 2);   // p2 was the last one holding the table up
  const h = mk(3, { runeDrawChance: 0 }); const t = h.state.turn;
  h.player(t).doubleDraw = true; h.dispatch(t, { type: 'draw' });
  assert.equal(h.state.pending.kind, 'pick'); const before = h.state.unitDeck.length;
  h.eliminate(t); assert.equal(h.state.pending, null); assert.equal(h.state.unitDeck.length, before + 2);
  const v = mk(4); const c = v.state.turn; turnOf(v, c); play(v, c, 'exile');
  assert.equal(v.state.pending.kind, 'vote'); const other = v.alivePlayers().find((p) => p.id !== c).id;
  v.eliminate(other); assert.ok(!v.state.pending.voters.includes(other)); assert.ok(!v.state.pending.candidates.includes(other));
  for (const id of [...v.state.pending.voters]) v.dispatch(id, { type: 'vote', target: v.state.pending.candidates[0] });
  assert.equal(v.state.pending, null);
});
test('eliminated players leave a clean state for scoring and the next round', () => {
  const g = mk(4); g.eliminate('p1');
  standAll(g);
  assert.equal(g.state.roundResult.rows.length, 3);
  for (const id of ['p0', 'p2', 'p3']) g.dispatch(id, { type: 'ready' });
  assert.equal(g.state.round, 2); assert.equal(g.player('p1').cards.length, 0);
  assert.equal(g.deckCopies(), 2);                                                      // 3 alive -> 2 copies
});

test('exceeded the target: normal draws are refused, draw runes still work', () => {
  const g = mk(2); turnOf(g, 'p0'); setCards(g, 'p0', [11, 11]);                 // 22 > 21
  assert.ok(g.dispatch('p0', { type: 'draw' }).error);
  assert.equal(g.getView('p0').legal.canDraw, false);
  const r = give(g, 'p0', 'twin_draw'); const n = g.player('p0').cards.length;
  assert.equal(g.dispatch('p0', { type: 'playRune', runeUid: r.uid, params: {} }).ok, true);
  assert.equal(g.player('p0').cards.length, n + 2);
});

test('timeoutAction lose: forfeit gives no more turns and loses the bet', () => {
  const g = mk(3, { timeoutAction: 'lose' }); turnOf(g, 'p0');
  setCards(g, 'p0', [10, 10]); setCards(g, 'p1', [5]); setCards(g, 'p2', [3]);
  assert.equal(g.forfeit('p0'), true);
  assert.notEqual(g.state.turn, 'p0');
  g.dispatch(g.state.turn, { type: 'stand' }); g.dispatch(g.state.turn, { type: 'stand' });   // p1, p2 stand; p0 is skipped
  assert.equal(g.state.phase, 'roundEnd');
  const row = g.state.roundResult.rows.find((r) => r.id === 'p0');
  assert.equal(row.forfeit, true); assert.equal(row.winner, false); assert.ok(row.loss > 0);
});

test('forfeit ranks last even when the forfeiter has the best total', () => {
  const g = mk(2); turnOf(g, 'p0'); setCards(g, 'p0', [10, 11]); setCards(g, 'p1', [2]);   // p0 is exactly 21
  g.forfeit('p0'); g.dispatch('p1', { type: 'stand' });
  const rows = g.state.roundResult.rows;
  assert.equal(rows.find((r) => r.id === 'p0').loss > 0, true); assert.equal(rows.find((r) => r.id === 'p1').winner, true);
});

test('rune rarity: 0 removes a colour, 2 doubles its copies; rune count can be hidden', () => {
  const base = buildRuneDeckList(1, {});
  const tier = (id) => RUNES[id].tier;
  assert.equal(buildRuneDeckList(1, { rarityWhite: 0 }).filter((id) => tier(id) === 1).length, 0);
  const w1 = base.filter((id) => tier(id) === 1).length, w2 = buildRuneDeckList(1, { rarityWhite: 2 }).filter((id) => tier(id) === 1).length;
  assert.equal(w2, w1 * 2);
  const g = mk(2, { showRuneCount: false });
  assert.equal(g.getView('p0').players[1].runeCount, null); assert.notEqual(g.getView('p0').players[0].runeCount, null);
});

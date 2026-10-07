// Pure functions: given game state, work out the current win condition, bet,
// and the outcome of a round. No side effects, no DOM, easy to unit test.
import { RUNES } from './runes.js';

export const cardTotal = (player) => player.cards.reduce((s, c) => s + c.value, 0);

/** The win condition. The most recently played active "target" rune wins. */
export function currentTarget(state) {
  for (let i = state.active.length - 1; i >= 0; i--) {
    const t = RUNES[state.active[i].runeId].target;
    if (t) return t;
  }
  if (state.twist && state.twist.target) return state.twist.target;   // this round's twist (a New Target rune still wins)
  return state.config.defaultTarget;
}

/** Round bet = (escalating base bet + every active rune's betMod) x the twist multiplier, floored at minBet. */
export function currentBet(state) {
  let bet = state.baseBet;
  for (const a of state.active) bet += RUNES[a.runeId].betMod || 0;
  return Math.max(state.config.minBet, bet * ((state.twist && state.twist.betMult) || 1));
}

/**
 * Score the round.
 * Ranking: anyone at or under the target beats anyone over it (a bust).
 * Among the non-busted, closest to the target wins. If everybody busts,
 * the smallest overshoot wins. Ties share the win (nobody in the tie loses).
 * Classic (config.lossFrac null): everyone who isn't a winner loses `bet` lives.
 * lossFrac 0..1: the worst `lossFrac` of the table lose `bet` lives (see applyLossFrac).
 * Then rune modifiers apply (Bless keeps everyone at 1 life or more).
 * Each row: `winner` = closest to the target (ties share it), `safe` = does not lose the bet.
 */
export function evaluateRound(state) {
  const target = currentTarget(state);
  const bet = currentBet(state);
  const players = state.players.filter((p) => p.alive);
  const rows = players.map((p) => {
    const total = cardTotal(p);
    return { id: p.id, total, target, forfeit: !!p.forfeited, bust: total > target, dist: Math.abs(target - total), notes: [], loss: 0, winner: false, reward: 0 };
  });
  const rank = (r) => (r.forfeit ? 2000 : r.bust ? 1000 : 0) + r.dist;     // lower is better; any bust ranks worse than any non-bust, a forfeit (timed out) worst of all
  const best = Math.min(...rows.map(rank));
  for (const r of rows) {
    r.rank = rank(r);
    r.winner = r.rank === best;
    r.safe = r.winner;
    r.loss = r.winner ? 0 : bet;
  }
  if (state.config.lossFrac != null) applyLossFrac(rows, state.config, bet);
  for (const r of rows) if (r.forfeit) r.notes.push('Ran out of time: forfeited the round');
  const row = (id) => rows.find((r) => r.id === id);
  const name = (id) => state.players.find((p) => p.id === id).name;

  // Helping Hand: if the protected player busted, the helper takes half the penalty (rounded up) and the protected player the rest.
  for (const a of state.active.filter((x) => x.runeId === 'helping_hand')) {
    const prot = row(a.data.targetId), helper = row(a.data.ownerId);
    if (prot && helper && prot.bust && prot.loss > 0 && prot.id !== helper.id) {
      const share = Math.ceil(prot.loss / 2);
      helper.loss += share; prot.loss -= share;
      helper.notes.push(`Helping Hand: took ${share} of ${name(prot.id)}\u2019s penalty`);
      prot.notes.push(`Helping Hand: ${name(helper.id)} took ${share}`);
    }
  }
  // Curse: the chosen player loses an additional life this round.
  for (const a of state.active.filter((x) => x.runeId === 'curse')) {
    const r = row(a.data.targetId);
    if (r) { r.loss += 1; r.notes.push('Cursed: +1'); }
  }
  // Wager: win -> draw 2 runes (applied by Game), lose -> +1 life lost.
  for (const a of state.active.filter((x) => x.runeId === 'wager')) {
    const r = row(a.owner);
    if (!r) continue;
    if (r.winner) { r.reward += 2; r.notes.push('Wager won: +2 runes'); }
    else { r.loss += 1; r.notes.push('Wager lost: +1'); }
  }
  // Jackpot tax.
  for (const p of players) {
    if (p.jackpotTax) { const r = row(p.id); r.loss += p.jackpotTax; r.notes.push(`Jackpot: +${p.jackpotTax}`); }
  }
  // Bless: nobody drops below 1 life this round.
  if (state.active.some((a) => a.runeId === 'bless')) {
    for (const r of rows) {
      const room = Math.max(0, state.players.find((p) => p.id === r.id).lives - 1);
      if (r.loss > room) { r.loss = room; r.notes.push('Blessed: stays at 1 life'); }
    }
  }
  return { target, bet, rows };
}

/**
 * Fraction scoring: sort everyone by rank, the worst ceil(lossFrac x players) lose `bet` lives.
 * Ties at the cutoff all lose (config.lossTies 'safe' spares them instead); if everyone ties nobody loses.
 */
export function applyLossFrac(rows, cfg, bet) {
  const N = rows.length;
  const round = { ceil: Math.ceil, floor: Math.floor, round: Math.round }[cfg.lossRounding] || Math.ceil;
  const frac = Math.max(0, Math.min(1, Number(cfg.lossFrac) || 0));
  const k = Math.max(0, Math.min(N, round(Math.round(frac * N * 1e6) / 1e6)));      // the rounding guards float noise (0.3 x 10)
  const ranks = rows.map((r) => r.rank).sort((a, b) => b - a);                       // worst first
  const allTie = ranks[0] === ranks[N - 1];
  const cutoff = k > 0 ? ranks[k - 1] : null;
  const lose = (r, sparing) => k > 0 && !allTie && (r.rank > cutoff || (r.rank === cutoff && !sparing));
  // lossTies 'safe' spares the players tied with the cutoff, but never so many that the round has no loser at all (the game would never end).
  const sparing = cfg.lossTies === 'safe' && rows.some((r) => lose(r, true));
  for (const r of rows) {
    const l = lose(r, sparing);
    r.safe = !l;
    r.loss = l ? bet : 0;
  }
}
